FROM python:3.14-slim

WORKDIR /app

COPY pyproject.toml ./
COPY README.md ./
COPY alembic.ini ./
COPY alembic ./alembic
COPY src ./src
COPY .python-version* ./
COPY entrypoint.sh ./

RUN pip install --no-cache-dir uv && uv pip install --system .

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]
