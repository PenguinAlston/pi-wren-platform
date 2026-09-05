/** 传统查询三大模块配置：契约/保全/理赔（需求 3.3–3.5）。 */

export type ModuleId = 'contract' | 'preserve' | 'claim';

export type FieldType = 'text' | 'select' | 'date' | 'number';

export interface QueryFieldDef {
  key: string;
  label: string;
  type: FieldType;
  /** select 时的字典类型（从 /api/dicts 拉取）。 */
  dictType?: string;
  /** select 时的自定义选项（如机构来自 /api/orgs）。 */
  source?: 'orgs';
  placeholder?: string;
}

export interface ColumnDef {
  key: string;
  label: string;
  /** 排序键（后端白名单，见 insurance-query sortColumns）。 */
  sortKey?: string;
  /** 窄列（如金额/日期）用于控制宽度。 */
  narrow?: boolean;
}

export interface DetailSection {
  key: string;
  title: string;
}

export interface FilterGroupDef {
  id: string;
  title: string;
  keys: string[];
}

export interface ModuleDef {
  id: ModuleId;
  label: string;
  /** 侧边栏站台图标 */
  icon: string;
  /** 侧边栏站台描述 */
  desc: string;
  fields: QueryFieldDef[];
  columns: ColumnDef[];
  detailSections: DetailSection[];
  /** 筛选条件分组（侧边栏折叠面板） */
  filterGroups: FilterGroupDef[];
  exportFilename: string;
}

export const MODULES: Record<ModuleId, ModuleDef> = {
  contract: {
    id: 'contract',
    label: '契约查询',
    icon: '▤',
    desc: '保单 · 承保 · 缴费',
    fields: [
      { key: 'policyNo', label: '保单号', type: 'text', placeholder: '支持模糊查询' },
      { key: 'productType', label: '险种类型', type: 'select', dictType: 'product_type' },
      { key: 'policyStatus', label: '保单状态', type: 'select', dictType: 'policy_status' },
      { key: 'applicantName', label: '投保人姓名', type: 'text', placeholder: '模糊匹配' },
      { key: 'applicantIdNo', label: '投保人证件号', type: 'text', placeholder: '模糊匹配' },
      { key: 'insuredName', label: '被保人姓名', type: 'text', placeholder: '模糊匹配' },
      { key: 'insuredIdNo', label: '被保人证件号', type: 'text', placeholder: '模糊匹配' },
      { key: 'orgCode', label: '承保机构', type: 'select', source: 'orgs' },
      { key: 'channelType', label: '投保渠道', type: 'select', dictType: 'channel_type' },
      { key: 'applyDateFrom', label: '投保日期起', type: 'date' },
      { key: 'applyDateTo', label: '投保日期止', type: 'date' },
      { key: 'premiumMin', label: '年交保费下限', type: 'number', placeholder: '金额' },
      { key: 'premiumMax', label: '年交保费上限', type: 'number', placeholder: '金额' },
    ],
    columns: [
      { key: 'policy_no', label: '保单号', sortKey: 'policyNo' },
      { key: 'product_name', label: '险种名称' },
      { key: 'policy_status_label', label: '保单状态', sortKey: 'policyStatus' },
      { key: 'applicant_name', label: '投保人' },
      { key: 'insured_name', label: '被保人' },
      { key: 'apply_date', label: '投保日期', sortKey: 'applyDate', narrow: true },
      { key: 'effect_date', label: '生效日期', sortKey: 'effectDate', narrow: true },
      { key: 'end_date', label: '终止日期', sortKey: 'endDate', narrow: true },
      { key: 'year_premium', label: '年交保费', sortKey: 'yearPremium', narrow: true },
      { key: 'total_amount', label: '累计保额', sortKey: 'totalAmount', narrow: true },
      { key: 'pay_type_label', label: '缴费方式' },
      { key: 'pay_year', label: '缴费年限', sortKey: 'payYear', narrow: true },
      { key: 'org_name', label: '承保机构', sortKey: 'orgCode' },
      { key: 'channel_label', label: '投保渠道', sortKey: 'channelType' },
    ],
    detailSections: [
      { key: 'riders', title: '附加险' },
      { key: 'benefits', title: '受益人' },
      { key: 'payLogs', title: '缴费记录' },
      { key: 'underwrite', title: '核保记录' },
    ],
    filterGroups: [
      { id: 'policy', title: '保单信息', keys: ['policyNo', 'productType', 'policyStatus'] },
      {
        id: 'people',
        title: '人员信息',
        keys: ['applicantName', 'applicantIdNo', 'insuredName', 'insuredIdNo'],
      },
      { id: 'channel', title: '渠道与机构', keys: ['orgCode', 'channelType'] },
      { id: 'time', title: '投保时间', keys: ['applyDateFrom', 'applyDateTo'] },
      { id: 'amount', title: '保费区间', keys: ['premiumMin', 'premiumMax'] },
    ],
    exportFilename: 'contract-export.csv',
  },

  preserve: {
    id: 'preserve',
    label: '保全查询',
    icon: '⇄',
    desc: '变更 · 复效 · 退保',
    fields: [
      { key: 'preserveId', label: '保全单号', type: 'text', placeholder: '支持模糊查询' },
      { key: 'policyId', label: '关联保单号', type: 'text', placeholder: '模糊匹配' },
      { key: 'preserveType', label: '保全类型', type: 'select', dictType: 'preserve_type' },
      { key: 'preserveStatus', label: '保全状态', type: 'select', dictType: 'preserve_status' },
      { key: 'applicantName', label: '申请人姓名', type: 'text', placeholder: '模糊匹配' },
      { key: 'applyTimeFrom', label: '申请时间起', type: 'date' },
      { key: 'applyTimeTo', label: '申请时间止', type: 'date' },
    ],
    columns: [
      { key: 'preserve_id', label: '保全单号', sortKey: 'preserveId' },
      { key: 'policy_id', label: '关联保单号', sortKey: 'policyId' },
      { key: 'preserve_type_label', label: '保全类型', sortKey: 'preserveType' },
      { key: 'preserve_status_label', label: '保全状态', sortKey: 'preserveStatus' },
      { key: 'applicant_name', label: '申请人' },
      { key: 'apply_time', label: '申请时间', sortKey: 'applyTime', narrow: true },
      { key: 'audit_time', label: '审核时间', sortKey: 'auditTime', narrow: true },
      { key: 'audit_user_name', label: '审核人' },
      { key: 'change_desc', label: '变更内容简述' },
    ],
    detailSections: [
      { key: 'details', title: '变更明细' },
      { key: 'fees', title: '费用变更' },
      { key: 'benefits', title: '受益人变更' },
      { key: 'statusChanges', title: '状态变更' },
    ],
    filterGroups: [
      { id: 'basic', title: '保全单', keys: ['preserveId', 'policyId', 'preserveType', 'preserveStatus'] },
      { id: 'people', title: '人员信息', keys: ['applicantName'] },
      { id: 'time', title: '申请时间', keys: ['applyTimeFrom', 'applyTimeTo'] },
    ],
    exportFilename: 'preserve-export.csv',
  },

  claim: {
    id: 'claim',
    label: '理赔查询',
    icon: '◈',
    desc: '报案 · 审核 · 赔付',
    fields: [
      { key: 'claimId', label: '理赔报案号', type: 'text', placeholder: '支持模糊查询' },
      { key: 'policyId', label: '关联保单号', type: 'text', placeholder: '模糊匹配' },
      { key: 'claimType', label: '理赔类型', type: 'select', dictType: 'claim_type' },
      { key: 'claimStatus', label: '理赔状态', type: 'select', dictType: 'claim_status' },
      { key: 'insuredName', label: '被保人姓名', type: 'text', placeholder: '模糊匹配' },
      { key: 'insuredIdNo', label: '被保人证件号', type: 'text', placeholder: '模糊匹配' },
      { key: 'reportTimeFrom', label: '报案时间起', type: 'date' },
      { key: 'reportTimeTo', label: '报案时间止', type: 'date' },
      { key: 'accidentArea', label: '出险地区', type: 'text', placeholder: '省市区' },
      { key: 'claimAmountMin', label: '赔付金额下限', type: 'number', placeholder: '实际赔付金额' },
      { key: 'claimAmountMax', label: '赔付金额上限', type: 'number', placeholder: '实际赔付金额' },
    ],
    columns: [
      { key: 'claim_id', label: '报案号', sortKey: 'claimId' },
      { key: 'policy_id', label: '关联保单号', sortKey: 'policyId' },
      { key: 'claim_type', label: '理赔类型', sortKey: 'claimType' },
      { key: 'insured_name', label: '被保人' },
      { key: 'accident_time', label: '出险时间', sortKey: 'accidentTime', narrow: true },
      { key: 'report_time', label: '报案时间', sortKey: 'reportTime', narrow: true },
      { key: 'claim_status_label', label: '理赔状态', sortKey: 'claimStatus' },
      { key: 'apply_claim_amount', label: '申请赔付金额', sortKey: 'applyAmount', narrow: true },
      { key: 'actual_claim_amount', label: '实际赔付金额', sortKey: 'actualAmount', narrow: true },
      { key: 'close_time', label: '结案时间', sortKey: 'closeTime', narrow: true },
    ],
    detailSections: [
      { key: 'payments', title: '赔付明细' },
      { key: 'audits', title: '审核记录' },
    ],
    filterGroups: [
      { id: 'basic', title: '理赔单', keys: ['claimId', 'policyId', 'claimType', 'claimStatus', 'accidentArea'] },
      { id: 'people', title: '人员信息', keys: ['insuredName', 'insuredIdNo'] },
      { id: 'time', title: '报案时间', keys: ['reportTimeFrom', 'reportTimeTo'] },
      { id: 'amount', title: '赔付金额', keys: ['claimAmountMin', 'claimAmountMax'] },
    ],
    exportFilename: 'claim-export.csv',
  },
};

/** 详情/列表通用列中文标签（详情主记录以 section.title 分组展示）。 */
export const COLUMN_LABELS: Record<string, string> = {
  policy_id: '保单号',
  policy_no: '保单号',
  policy_status: '保单状态编码',
  policy_status_label: '保单状态',
  product_type: '险种类型编码',
  product_name: '险种名称',
  applicant_name: '投保人',
  applicant_id_no: '投保人证件号',
  applicant_phone: '投保人电话',
  insured_name: '被保人',
  insured_id_no: '被保人证件号',
  insured_phone: '被保人电话',
  apply_date: '投保日期',
  effect_date: '生效日期',
  end_date: '终止日期',
  year_premium: '年交保费',
  total_premium: '总保费',
  total_amount: '累计保额',
  pay_type: '缴费方式编码',
  pay_type_label: '缴费方式',
  pay_year: '缴费年限',
  insure_period: '保障期限',
  org_code: '机构编码',
  org_name: '承保机构',
  channel_type: '渠道编码',
  channel_label: '投保渠道',
  agent_id: '代理人ID',
  underwrite_result: '核保结果',
  surrender_date: '退保日期',
  create_time: '创建时间',
  update_time: '更新时间',
  preserve_id: '保全单号',
  preserve_type: '保全类型编码',
  preserve_type_label: '保全类型',
  preserve_status: '保全状态编码',
  preserve_status_label: '保全状态',
  apply_customer_id: '申请人ID',
  apply_time: '申请时间',
  audit_time: '审核时间',
  audit_user_id: '审核人ID',
  audit_user_name: '审核人',
  audit_opinion: '审核意见',
  change_desc: '变更内容简述',
  claim_id: '理赔报案号',
  claim_type: '理赔类型',
  claim_status: '理赔状态编码',
  claim_status_label: '理赔状态',
  insured_id: '被保人ID',
  accident_time: '出险时间',
  report_time: '报案时间',
  accident_area: '出险地区',
  apply_claim_amount: '申请赔付金额',
  actual_claim_amount: '实际赔付金额',
  close_time: '结案时间',
  claim_reason: '出险原因',
};

/** 格式化单元格：ISO 时间 → 本地 YYYY-MM-DD HH:mm；金额补千分位。 */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return String(value);
    }
    return value.toLocaleString('zh-CN', { minimumFractionDigits: 2 });
  }
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
      }
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
    if (/^\d+(\.\d+)?$/.test(value) && value.length <= 18) {
      const number = Number(value);
      if (Number.isFinite(number)) {
        // 金额/大数值才加千分位；短编码（02、1 等）保持原样
        const [intPart = ''] = value.split('.');
        if (value.includes('.') || intPart.length >= 4) {
          return number.toLocaleString('zh-CN', {
            minimumFractionDigits: value.includes('.') ? 2 : 0,
          });
        }
      }
    }
  }
  return String(value);
}
