FROM python:3.11-slim

WORKDIR /app

# Build context is the project root (run with: docker build -f services/email-calendar/Dockerfile .)
COPY services/email-calendar/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the proxy layer
COPY services/email-calendar/app/ ./app/

# Copy the original server and supporting files into app/
COPY oauth_server.py ./app/oauth_server.py
COPY ab_testing.py ./app/ab_testing.py
COPY tests.json ./app/tests.json

EXPOSE 8081

ENV PORT=8081

CMD ["python", "app/server.py"]
