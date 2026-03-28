FROM node:20-alpine

RUN apk add --no-cache python3 make g++ wget

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production=false

COPY . .
RUN npm run build

RUN mkdir -p /data

EXPOSE 3001

CMD ["node", "dist/index.js"]
