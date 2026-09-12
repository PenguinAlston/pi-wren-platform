# postgres 18.4 + Apache AGE 1.7.0
# 在官方 postgres:18.4-alpine 基础上编译安装 AGE（多阶段：工具链不进运行层），
# 数据卷与原 postgres:18.4-alpine 大版本一致，无需重建。
#   docker build -f infra/age-postgres.Dockerfile -t pi-wren-postgres-age:18.4 infra
# AGE 1.7.0 = 官方对 PostgreSQL 18 的 release；源码包预置于构建上下文
# （infra/apache-age-src.tar.gz，gitignore，下载自 archive.apache.org/dist/age/PG18/1.7.0/）

FROM postgres:18.4-alpine AS builder

ARG AGE_VERSION=1.7.0
COPY apache-age-src.tar.gz /tmp/age.tar.gz

RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories \
    && apk add --no-cache build-base flex bison perl \
    && tar xzf /tmp/age.tar.gz -C /tmp \
    && cd /tmp/apache-age-${AGE_VERSION} \
    # with_llvm=no：跳过 LLVM bitcode 生成（alpine 无 clang-21），JIT 内联优化缺失不影响功能
    && make USE_PGXS=1 PG_CONFIG=/usr/local/bin/pg_config with_llvm=no \
    && make install USE_PGXS=1 PG_CONFIG=/usr/local/bin/pg_config with_llvm=no

FROM postgres:18.4-alpine

COPY --from=builder /usr/local/lib/postgresql/ /usr/local/lib/postgresql/
COPY --from=builder /usr/local/share/postgresql/extension/ /usr/local/share/postgresql/extension/

# 运行层与官方 postgres:18.4-alpine 完全同参（entrypoint/env/卷不变）
