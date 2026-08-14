# backend 生产镜像（构建上下文 = backend/）
#   docker build -t piwren-backend backend/
# 基础镜像可换国内源：--build-arg PYTHON_IMAGE=docker.1ms.run/library/python:3.12-slim
ARG PYTHON_IMAGE=python:3.12-slim
FROM ${PYTHON_IMAGE}

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    # embedding 模型下载走国内镜像（运行时 memory index 需要；可被 -e 覆盖）
    HF_ENDPOINT=https://hf-mirror.com

# 国内源默认，海外构建用 --build-arg PIP_INDEX_URL=https://pypi.org/simple
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

WORKDIR /app

# 先装依赖（层缓存）：用最小包骨架触发 pyproject 依赖解析
COPY pyproject.toml ./
RUN mkdir -p app && touch app/__init__.py \
    && pip install --no-cache-dir --index-url ${PIP_INDEX_URL} -e . \
    && rm -rf app

COPY app ./app

EXPOSE 8080
# 生产前置：semantic/wren 需挂载（含 target/mdl.json 与 .wren 记忆索引），见 docker-compose.prod.yml
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
