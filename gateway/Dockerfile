FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm i --omit=dev
COPY server.js ./
COPY public ./public
EXPOSE 8080
CMD ["node", "server.js"]