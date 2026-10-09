FROM python:3.14-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# One process on purpose: race rooms live in its memory
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
