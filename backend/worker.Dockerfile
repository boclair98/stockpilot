FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

ENV UV_NO_CACHE=1
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --no-dev

COPY . .

RUN sed -i 's/\r$//' worker-entrypoint.sh && chmod +x worker-entrypoint.sh && \
    useradd --system --no-create-home --uid 1001 appuser && \
    chown -R appuser /app

USER appuser

ENTRYPOINT ["./worker-entrypoint.sh"]

