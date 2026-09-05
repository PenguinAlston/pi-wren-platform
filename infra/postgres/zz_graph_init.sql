-- =====================================================================
-- Apache AGE 图数据库初始化 + 保险关系数据 → 知识图谱同步
-- 文件名 zz_ 前缀：docker-entrypoint-initdb.d 按字典序执行，本文件最后跑
-- （此时全部业务表 + 种子数据已就绪）。
-- 幂等：每次执行 drop + 重建 insurance_graph 图，再从关系表全量装载。
-- 手动重建：docker exec -i <pg容器> psql -U demo -d piwren \
--             -f /docker-entrypoint-initdb.d/zz_graph_init.sql
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS age;
LOAD 'age';
SET search_path = ag_catalog, "$user", public;

-- 重建图（不存在时忽略报错）
DO $$
BEGIN
    PERFORM drop_graph('insurance_graph', true);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT create_graph('insurance_graph');

-- ---------------------------------------------------------------------
-- 节点装载（UNWIND + 参数批量 CREATE；关系表行 → jsonb → agtype 参数）
-- ---------------------------------------------------------------------

-- 机构：sys_org
SELECT * FROM ag_catalog.cypher('insurance_graph', $cy$
    UNWIND $rows AS r
    CREATE (:Org {gid: r.gid, name: r.name, shortName: r.shortName, level: r.level})
$cy$, (SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(jsonb_build_object(
        'gid', org_id, 'name', org_name, 'shortName', org_short_name, 'level', org_level)),
        '[]'::jsonb)) FROM sys_org)::text::ag_catalog.agtype) AS (v agtype);

-- 系统用户：sys_user
SELECT * FROM ag_catalog.cypher('insurance_graph', $cy$
    UNWIND $rows AS r
    CREATE (:SysUser {gid: r.gid, name: r.name, userType: r.userType})
$cy$, (SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(jsonb_build_object(
        'gid', user_id, 'name', user_name, 'userType', user_type)),
        '[]'::jsonb)) FROM sys_user)::text::ag_catalog.agtype) AS (v agtype);

-- 产品：ins_product_main
SELECT * FROM ag_catalog.cypher('insurance_graph', $cy$
    UNWIND $rows AS r
    CREATE (:Product {gid: r.gid, name: r.name, productType: r.productType, status: r.status})
$cy$, (SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(jsonb_build_object(
        'gid', product_id, 'name', product_name, 'productType', product_type, 'status', product_status)),
        '[]'::jsonb)) FROM ins_product_main)::text::ag_catalog.agtype) AS (v agtype);

-- 客户：ins_customer
SELECT * FROM ag_catalog.cypher('insurance_graph', $cy$
    UNWIND $rows AS r
    CREATE (:Customer {gid: r.gid, name: r.name, gender: r.gender})
$cy$, (SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(jsonb_build_object(
        'gid', customer_id, 'name', customer_name, 'gender', gender)),
        '[]'::jsonb)) FROM ins_customer)::text::ag_catalog.agtype) AS (v agtype);

-- 保单：ins_policy_main
SELECT * FROM ag_catalog.cypher('insurance_graph', $cy$
    UNWIND $rows AS r
    CREATE (:Policy {gid: r.gid, name: r.name, status: r.status,
                     premium: r.premium, totalAmount: r.totalAmount})
$cy$, (SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(jsonb_build_object(
        'gid', policy_id, 'name', policy_no, 'status', policy_status,
        'premium', year_premium, 'totalAmount', total_amount)),
        '[]'::jsonb)) FROM ins_policy_main)::text::ag_catalog.agtype) AS (v agtype);

-- 理赔：ins_claim_main
SELECT * FROM ag_catalog.cypher('insurance_graph', $cy$
    UNWIND $rows AS r
    CREATE (:Claim {gid: r.gid, name: r.name, claimType: r.claimType,
                    status: r.status, applyAmount: r.applyAmount})
$cy$, (SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(jsonb_build_object(
        'gid', claim_id, 'name', claim_id, 'claimType', claim_type,
        'status', claim_status, 'applyAmount', apply_claim_amount)),
        '[]'::jsonb)) FROM ins_claim_main)::text::ag_catalog.agtype) AS (v agtype);

-- 保全：ins_preserve_main
SELECT * FROM ag_catalog.cypher('insurance_graph', $cy$
    UNWIND $rows AS r
    CREATE (:Preserve {gid: r.gid, name: r.name, preserveType: r.preserveType, status: r.status})
$cy$, (SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(jsonb_build_object(
        'gid', preserve_id, 'name', preserve_id, 'preserveType', preserve_type, 'status', preserve_status)),
        '[]'::jsonb)) FROM ins_preserve_main)::text::ag_catalog.agtype) AS (v agtype);

-- ---------------------------------------------------------------------
-- 关系装载（MATCH 端点 + CREATE 边；节点已在上一步就绪）
-- ---------------------------------------------------------------------

-- 机构树：(:Org)-[:CHILD_OF]->(:Org 父机构)
SELECT * FROM ag_catalog.cypher('insurance_graph', $cy$
    UNWIND $rows AS r
    MATCH (c:Org {gid: r.child}), (p:Org {gid: r.parent})
    CREATE (c)-[:CHILD_OF]->(p)
$cy$, (SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(jsonb_build_object(
        'child', org_id, 'parent', parent_org_id)), '[]'::jsonb))
       FROM sys_org WHERE parent_org_id IS NOT NULL)::text::ag_catalog.agtype) AS (v agtype);

-- 员工归属：(:SysUser)-[:BELONGS_TO]->(:Org)
SELECT * FROM ag_catalog.cypher('insurance_graph', $cy$
    UNWIND $rows AS r
    MATCH (u:SysUser {gid: r.uid}), (o:Org {gid: r.oid})
    CREATE (u)-[:BELONGS_TO]->(o)
$cy$, (SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(jsonb_build_object(
        'uid', user_id, 'oid', org_id)), '[]'::jsonb)) FROM sys_user)::text::ag_catalog.agtype) AS (v agtype);

-- 投保人：(:Customer)-[:APPLICANT_OF]->(:Policy)
SELECT * FROM ag_catalog.cypher('insurance_graph', $cy$
    UNWIND $rows AS r
    MATCH (c:Customer {gid: r.cid}), (p:Policy {gid: r.pid})
    CREATE (c)-[:APPLICANT_OF]->(p)
$cy$, (SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(jsonb_build_object(
        'cid', applicant_id, 'pid', policy_id)), '[]'::jsonb))
       FROM ins_policy_main)::text::ag_catalog.agtype) AS (v agtype);

-- 被保人：(:Customer)-[:INSURED_OF]->(:Policy)
SELECT * FROM ag_catalog.cypher('insurance_graph', $cy$
    UNWIND $rows AS r
    MATCH (c:Customer {gid: r.cid}), (p:Policy {gid: r.pid})
    CREATE (c)-[:INSURED_OF]->(p)
$cy$, (SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(jsonb_build_object(
        'cid', insured_id, 'pid', policy_id)), '[]'::jsonb))
       FROM ins_policy_main)::text::ag_catalog.agtype) AS (v agtype);

-- 受益人：(:Customer)-[:BENEFICIARY_OF {rate}]->(:Policy)
SELECT * FROM ag_catalog.cypher('insurance_graph', $cy$
    UNWIND $rows AS r
    MATCH (c:Customer {gid: r.cid}), (p:Policy {gid: r.pid})
    CREATE (c)-[:BENEFICIARY_OF {rate: r.rate, level: r.level}]->(p)
$cy$, (SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(jsonb_build_object(
        'cid', customer_id, 'pid', policy_id, 'rate', benefit_rate, 'level', benefit_level)),
        '[]'::jsonb)) FROM ins_policy_benefit)::text::ag_catalog.agtype) AS (v agtype);

-- 承保产品：(:Policy)-[:OF_PRODUCT]->(:Product)
SELECT * FROM ag_catalog.cypher('insurance_graph', $cy$
    UNWIND $rows AS r
    MATCH (p:Policy {gid: r.pid}), (pr:Product {gid: r.prid})
    CREATE (p)-[:OF_PRODUCT]->(pr)
$cy$, (SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(jsonb_build_object(
        'pid', policy_id, 'prid', product_id)), '[]'::jsonb))
       FROM ins_policy_main)::text::ag_catalog.agtype) AS (v agtype);

-- 出单机构：(:Policy)-[:ISSUED_BY]->(:Org)
SELECT * FROM ag_catalog.cypher('insurance_graph', $cy$
    UNWIND $rows AS r
    MATCH (p:Policy {gid: r.pid}), (o:Org {gid: r.oid})
    CREATE (p)-[:ISSUED_BY]->(o)
$cy$, (SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(jsonb_build_object(
        'pid', policy_id, 'oid', org_code)), '[]'::jsonb))
       FROM ins_policy_main)::text::ag_catalog.agtype) AS (v agtype);

-- 附加险：(:Policy)-[:HAS_RIDER]->(:Product)（附加险产品需存在于产品表）
SELECT * FROM ag_catalog.cypher('insurance_graph', $cy$
    UNWIND $rows AS r
    MATCH (p:Policy {gid: r.pid}), (pr:Product {gid: r.prid})
    CREATE (p)-[:HAS_RIDER]->(pr)
$cy$, (SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(jsonb_build_object(
        'pid', policy_id, 'prid', rider_product_id)), '[]'::jsonb))
       FROM (SELECT DISTINCT policy_id, rider_product_id FROM ins_policy_rider) s
       WHERE EXISTS (SELECT 1 FROM ins_product_main m WHERE m.product_id = s.rider_product_id))
       ::text::ag_catalog.agtype) AS (v agtype);

-- 理赔：(:Policy)-[:HAS_CLAIM]->(:Claim)
SELECT * FROM ag_catalog.cypher('insurance_graph', $cy$
    UNWIND $rows AS r
    MATCH (p:Policy {gid: r.pid}), (c:Claim {gid: r.cid})
    CREATE (p)-[:HAS_CLAIM]->(c)
$cy$, (SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(jsonb_build_object(
        'pid', policy_id, 'cid', claim_id)), '[]'::jsonb))
       FROM ins_claim_main)::text::ag_catalog.agtype) AS (v agtype);

-- 保全：(:Policy)-[:HAS_PRESERVE]->(:Preserve)
SELECT * FROM ag_catalog.cypher('insurance_graph', $cy$
    UNWIND $rows AS r
    MATCH (p:Policy {gid: r.pid}), (v:Preserve {gid: r.vid})
    CREATE (p)-[:HAS_PRESERVE]->(v)
$cy$, (SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(jsonb_build_object(
        'pid', policy_id, 'vid', preserve_id)), '[]'::jsonb))
       FROM ins_preserve_main)::text::ag_catalog.agtype) AS (v agtype);

-- 核保人：(:SysUser)-[:UNDERWROTE]->(:Policy)
SELECT * FROM ag_catalog.cypher('insurance_graph', $cy$
    UNWIND $rows AS r
    MATCH (u:SysUser {gid: r.uid}), (p:Policy {gid: r.pid})
    CREATE (u)-[:UNDERWROTE]->(p)
$cy$, (SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(jsonb_build_object(
        'uid', underwrite_user, 'pid', policy_id)), '[]'::jsonb))
       FROM (SELECT DISTINCT underwrite_user, policy_id FROM ins_policy_underwrite) s)
       ::text::ag_catalog.agtype) AS (v agtype);

-- 理赔审核人：(:SysUser)-[:AUDITED]->(:Claim)
SELECT * FROM ag_catalog.cypher('insurance_graph', $cy$
    UNWIND $rows AS r
    MATCH (u:SysUser {gid: r.uid}), (c:Claim {gid: r.cid})
    CREATE (u)-[:AUDITED]->(c)
$cy$, (SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(jsonb_build_object(
        'uid', audit_user_id, 'cid', claim_id)), '[]'::jsonb))
       FROM (SELECT DISTINCT audit_user_id, claim_id FROM ins_claim_audit) s)
       ::text::ag_catalog.agtype) AS (v agtype);

-- 保全申请人：(:Customer)-[:APPLIED_PRESERVE]->(:Preserve)
SELECT * FROM ag_catalog.cypher('insurance_graph', $cy$
    UNWIND $rows AS r
    MATCH (c:Customer {gid: r.cid}), (v:Preserve {gid: r.vid})
    CREATE (c)-[:APPLIED_PRESERVE]->(v)
$cy$, (SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(jsonb_build_object(
        'cid', apply_customer_id, 'vid', preserve_id)), '[]'::jsonb))
       FROM ins_preserve_main)::text::ag_catalog.agtype) AS (v agtype);

-- ---------------------------------------------------------------------
-- 装载结果校验（注释状态，需要时手动执行）
--   SELECT * FROM ag_catalog.cypher('insurance_graph',
--     $$ MATCH (n) RETURN label(n) AS label, count(n) AS cnt $$)
--   AS (label agtype, cnt agtype);
-- ---------------------------------------------------------------------
