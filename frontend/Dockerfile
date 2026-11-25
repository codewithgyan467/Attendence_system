FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
RUN printf 'server {\n  listen 3000;\n  root /usr/share/nginx/html;\n  index index.html;\n  location /api/ {\n    proxy_pass http://backend:5000/api/;\n    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n  }\n  location = /health {\n    proxy_pass http://backend:5000/health;\n  }\n  location = /ping-hostel {\n    proxy_pass http://backend:5000/ping-hostel;\n  }\n  location / {\n    try_files $uri $uri/ /index.html;\n  }\n}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
