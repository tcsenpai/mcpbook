#!/bin/bash
cp .env.demosdk .env
npm install
npm run build
chmod +x dist/index.js


echo "Demosdk compiled successfully."
echo "To run the Demos SDK MCP server, use the command:"
echo "npm run start"
echo "You can also add the mcp server to any tool by pointing them to the dist/index.js file."
echo "For example, in claude code you can use:"
echo "claude mcp add /path/to/demosdk_mcp_server/dist/index.js"