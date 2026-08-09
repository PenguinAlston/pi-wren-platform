-- HR（人力资源）schema：用于测试"从数据库导入"生成 Agent 的功能。
-- 独立 schema，带主键/外键约束，便于内省出 models + relationships。
-- 列注释用 COMMENT，内省不读注释（中文业务含义靠导入时的描述补充）。

CREATE SCHEMA IF NOT EXISTS hr;

-- ---- 部门（树形：parent_id 自引用）----
CREATE TABLE IF NOT EXISTS hr.department (
    dept_id      VARCHAR(20) PRIMARY KEY,
    dept_name    VARCHAR(100) NOT NULL,
    parent_id    VARCHAR(20),
    manager_id   VARCHAR(20),
    establish_date DATE,
    status       VARCHAR(4) NOT NULL DEFAULT '1',  -- 1=启用 0=停用
    CONSTRAINT fk_dept_parent FOREIGN KEY (parent_id)
        REFERENCES hr.department(dept_id)
);

COMMENT ON TABLE  hr.department IS '部门信息表（树形结构）';
COMMENT ON COLUMN hr.department.dept_id IS '部门编号';
COMMENT ON COLUMN hr.department.dept_name IS '部门名称';
COMMENT ON COLUMN hr.department.parent_id IS '上级部门编号（顶级为空）';
COMMENT ON COLUMN hr.department.manager_id IS '部门负责人员工编号';
COMMENT ON COLUMN hr.department.establish_date IS '成立日期';
COMMENT ON COLUMN hr.department.status IS '状态：1=启用 0=停用';

-- ---- 岗位 ----
CREATE TABLE IF NOT EXISTS hr.position (
    position_id   VARCHAR(20) PRIMARY KEY,
    position_name VARCHAR(80) NOT NULL,
    position_level VARCHAR(10),          -- P1/P2/.../P7 职级
    base_salary   NUMERIC(10, 2),        -- 岗位基准薪资
    status        VARCHAR(4) NOT NULL DEFAULT '1'
);

COMMENT ON TABLE  hr.position IS '岗位表';
COMMENT ON COLUMN hr.position.position_id IS '岗位编号';
COMMENT ON COLUMN hr.position.position_name IS '岗位名称';
COMMENT ON COLUMN hr.position.position_level IS '职级（P1-P7）';
COMMENT ON COLUMN hr.position.base_salary IS '岗位基准月薪';
COMMENT ON COLUMN hr.position.status IS '状态：1=启用 0=停用';

-- ---- 员工 ----
CREATE TABLE IF NOT EXISTS hr.employee (
    emp_id        VARCHAR(20) PRIMARY KEY,
    emp_name      VARCHAR(50) NOT NULL,
    gender        VARCHAR(2) NOT NULL,            -- 1=男 2=女
    birthday      DATE,
    phone         VARCHAR(20),
    email         VARCHAR(100),
    hire_date     DATE NOT NULL,
    dept_id       VARCHAR(20) NOT NULL,
    position_id   VARCHAR(20) NOT NULL,
    employ_status VARCHAR(4) NOT NULL DEFAULT '1', -- 1=在职 2=试用期 3=离职
    CONSTRAINT fk_emp_dept     FOREIGN KEY (dept_id)     REFERENCES hr.department(dept_id),
    CONSTRAINT fk_emp_position FOREIGN KEY (position_id) REFERENCES hr.position(position_id)
);

COMMENT ON TABLE  hr.employee IS '员工主表';
COMMENT ON COLUMN hr.employee.emp_id IS '员工编号';
COMMENT ON COLUMN hr.employee.emp_name IS '姓名';
COMMENT ON COLUMN hr.employee.gender IS '性别：1=男 2=女';
COMMENT ON COLUMN hr.employee.hire_date IS '入职日期';
COMMENT ON COLUMN hr.employee.dept_id IS '所属部门编号';
COMMENT ON COLUMN hr.employee.position_id IS '岗位编号';
COMMENT ON COLUMN hr.employee.employ_status IS '在职状态：1=在职 2=试用期 3=离职';

-- ---- 考勤打卡 ----
CREATE TABLE IF NOT EXISTS hr.attendance (
    attendance_id SERIAL PRIMARY KEY,
    emp_id        VARCHAR(20) NOT NULL,
    record_date   DATE NOT NULL,
    check_in_time TIMESTAMP,
    check_out_time TIMESTAMP,
    attend_status VARCHAR(4) NOT NULL,            -- 1=正常 2=迟到 3=早退 4=缺勤
    work_hours    NUMERIC(4, 1),
    CONSTRAINT fk_att_emp FOREIGN KEY (emp_id) REFERENCES hr.employee(emp_id)
);

COMMENT ON TABLE  hr.attendance IS '考勤记录表';
COMMENT ON COLUMN hr.attendance.record_date IS '考勤日期';
COMMENT ON COLUMN hr.attendance.check_in_time IS '上班打卡时间';
COMMENT ON COLUMN hr.attendance.check_out_time IS '下班打卡时间';
COMMENT ON COLUMN hr.attendance.attend_status IS '考勤状态：1=正常 2=迟到 3=早退 4=缺勤';
COMMENT ON COLUMN hr.attendance.work_hours IS '当日工时（小时）';

-- ---- 薪资发放 ----
CREATE TABLE IF NOT EXISTS hr.payroll (
    payroll_id    SERIAL PRIMARY KEY,
    emp_id        VARCHAR(20) NOT NULL,
    pay_month     VARCHAR(7) NOT NULL,            -- YYYY-MM
    base_pay      NUMERIC(10, 2) NOT NULL,        -- 基本工资
    bonus         NUMERIC(10, 2) DEFAULT 0,       -- 奖金
    deduction     NUMERIC(10, 2) DEFAULT 0,       -- 扣款
    net_pay       NUMERIC(10, 2) NOT NULL,        -- 实发
    pay_status    VARCHAR(4) NOT NULL DEFAULT '1', -- 1=已发 2=待发
    CONSTRAINT fk_pay_emp FOREIGN KEY (emp_id) REFERENCES hr.employee(emp_id)
);

COMMENT ON TABLE  hr.payroll IS '薪资发放表';
COMMENT ON COLUMN hr.payroll.pay_month IS '薪资月份（YYYY-MM）';
COMMENT ON COLUMN hr.payroll.base_pay IS '基本工资';
COMMENT ON COLUMN hr.payroll.bonus IS '奖金';
COMMENT ON COLUMN hr.payroll.deduction IS '扣款';
COMMENT ON COLUMN hr.payroll.net_pay IS '实发工资';
COMMENT ON COLUMN hr.payroll.pay_status IS '发放状态：1=已发 2=待发';

-- ---- 离职记录 ----
CREATE TABLE IF NOT EXISTS hr.resignation (
    resignation_id SERIAL PRIMARY KEY,
    emp_id         VARCHAR(20) NOT NULL,
    resign_date    DATE NOT NULL,
    resign_reason  VARCHAR(20) NOT NULL,          -- 01=个人发展 02=薪资 03=家庭 04=合同到期 99=其他
    resign_type    VARCHAR(4) NOT NULL,           -- 1=主动 2=被动（辞退）
    approve_status VARCHAR(4) NOT NULL DEFAULT '1', -- 1=已批 2=审批中
    CONSTRAINT fk_res_emp FOREIGN KEY (emp_id) REFERENCES hr.employee(emp_id)
);

COMMENT ON TABLE  hr.resignation IS '离职记录表';
COMMENT ON COLUMN hr.resignation.resign_date IS '离职日期';
COMMENT ON COLUMN hr.resignation.resign_reason IS '离职原因：01=个人发展 02=薪资 03=家庭 04=合同到期 99=其他';
COMMENT ON COLUMN hr.resignation.resign_type IS '离职类型：1=主动 2=被动';
COMMENT ON COLUMN hr.resignation.approve_status IS '审批状态：1=已批 2=审批中';
