Set-Location "C:\Users\s7488\secureid-website"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "node server/server.js"
