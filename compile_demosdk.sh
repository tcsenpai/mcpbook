#!/bin/bash
cp .env.demosdk .env
npm install
npm run build

echo "Demosdk compiled successfully."
echo "To run the Demos SDK MCP server, use the command:"
echo "npm run start"