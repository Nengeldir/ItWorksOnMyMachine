# Built from the repo root (docker-compose.yml) so it can copy shared/ as well
FROM python:3.14-slim

WORKDIR /app/backend

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# The shared catalog (items, recipes, skills...), read from ../shared/catalog like in the repo
COPY shared/ /app/shared/
COPY backend/ .

# One process on purpose: race rooms live in its memory
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
