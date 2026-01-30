# UPDATE: Wir nutzen jetzt die aktuelle LTS Version 24
FROM node:24-alpine

WORKDIR /app

# Dependencies installieren
COPY package.json ./
RUN npm install --production

# Code kopieren
COPY . .

EXPOSE 8555
# UPDATE: Kein Flag mehr nötig in Node 24!
CMD ["node", "server.js"]