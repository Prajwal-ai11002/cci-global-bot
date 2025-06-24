FROM node:20 AS builder
WORKDIR /app

# Copy only the frontend source folder
COPY frontend/ ./                  
COPY .env .env                      

RUN npm install
RUN npm run build

FROM nginx:stable-alpine
COPY --from=builder /app/build /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
