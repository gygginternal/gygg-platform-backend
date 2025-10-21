#!/bin/bash

# WebSocket Integration Fix Script
# This script applies the correct WebSocket integration fix for contract creation

echo "🔧 Applying WebSocket Integration Fix for Contract Creation"
echo "======================================================"

# Step 1: Add getChatWebsocket function to chatController.js
echo ""
echo "1️⃣ Adding getChatWebsocket function to chatController.js..."

# Find the line after setChatWebsocket function
LINE_AFTER_SET_WEBSOCKET=$(grep -n "export const setChatWebsocket" /media/devenderbutani/SSD2/Code/Gygg/Gygg-App/gygg-platform-backend/src/controllers/chatController.js | cut -d: -f1)
INSERT_LINE=$((LINE_AFTER_SET_WEBSOCKET + 2))

# Insert the getChatWebsocket function
sed -i "${INSERT_LINE}i\\
export const getChatWebsocket = () => {\\
  return chatWebsocket;\\
};" /media/devenderbutani/SSD2/Code/Gygg/Gygg-App/gygg-platform-backend/src/controllers/chatController.js

echo "✅ Added getChatWebsocket function to chatController.js"

# Step 2: Add WebSocket import to applicationController.js
echo ""
echo "2️⃣ Adding WebSocket import to applicationController.js..."

# Check if import already exists
if ! grep -q "getChatWebsocket" /media/devenderbutani/SSD2/Code/Gygg/Gygg-App/gygg-platform-backend/src/controllers/applicationController.js; then
  # Find the line after the last import
  LAST_IMPORT_LINE=$(grep -n "^import" /media/devenderbutani/SSD2/Code/Gygg/Gygg-App/gygg-platform-backend/src/controllers/applicationController.js | tail -1 | cut -d: -f1)
  INSERT_LINE=$((LAST_IMPORT_LINE + 1))
  
  # Insert the import
  sed -i "${INSERT_LINE}i\\
import { getChatWebsocket } from './chatController.js';" /media/devenderbutani/SSD2/Code/Gygg/Gygg-App/gygg-platform-backend/src/controllers/applicationController.js
  
  echo "✅ Added WebSocket import to applicationController.js"
else
  echo "✅ WebSocket import already exists in applicationController.js"
fi

# Step 3: Add WebSocket event emission to acceptApplication function
echo ""
echo "3️⃣ Adding WebSocket event emission to acceptApplication function..."

# Check if WebSocket event emission already exists
if ! grep -q "Emit WebSocket events to notify connected clients" /media/devenderbutani/SSD2/Code/Gygg/Gygg-App/gygg-platform-backend/src/controllers/applicationController.js; then
  # Find the line after contract creation success logging
  CONTRACT_LOG_LINE=$(grep -n "logger.info.*Contract.*created successfully" /media/devenderbutani/SSD2/Code/Gygg/Gygg-App/gygg-platform-backend/src/controllers/applicationController.js | cut -d: -f1)
  INSERT_LINE=$((CONTRACT_LOG_LINE + 1))
  
  # Insert the WebSocket event emission code
  sed -i "${INSERT_LINE}a\\
\\
  // Emit WebSocket events to notify connected clients\\
  const chatWebsocket = getChatWebsocket();\\
  if (chatWebsocket) {\\
    try {\\
      // Emit to provider (gig poster)\\
      chatWebsocket.emitNewMessage(gig.postedBy._id || gig.postedBy, {\\
        type: 'contract_created',\\
        content: \`A new contract has been created for your gig: \${gig.title}\`,\\
        gigId: gig._id,\\
        contractId: contract._id,\\
        taskerId: application.user._id,\\
        timestamp: new Date().toISOString()\\
      });\\
\\
      // Emit to tasker (gig applicant)\\
      chatWebsocket.emitNewMessage(application.user._id, {\\
        type: 'contract_accepted',\\
        content: \`Your application for gig '\${gig.title}' has been accepted! A new contract has been created.\`,\\
        gigId: gig._id,\\
        contractId: contract._id,\\
        providerId: gig.postedBy._id || gig.postedBy,\\
        timestamp: new Date().toISOString()\\
      });\\
\\
      logger.info(\`[WS] Contract creation events emitted for gig \${gig._id} and contract \${contract._id}\`);\\
    } catch (websocketError) {\\
      logger.error('[WS] Error emitting contract creation events:', websocketError.message);\\
    }\\
  }" /media/devenderbutani/SSD2/Code/Gygg/Gygg-App/gygg-platform-backend/src/controllers/applicationController.js
  
  echo "✅ Added WebSocket event emission to acceptApplication function"
else
  echo "✅ WebSocket event emission already exists in acceptApplication function"
fi

echo ""
echo "📋 WebSocket Integration Fix Summary:"
echo "=================================="
echo "✅ Modified chatController.js to export getChatWebsocket function"
echo "✅ Added WebSocket import to applicationController.js"
echo "✅ Added WebSocket event emission after contract creation"
echo "✅ Implemented error handling for WebSocket operations"
echo "✅ Added logging for WebSocket event emission"
echo "✅ Events will be emitted to both provider and tasker"

echo ""
echo "🔧 Frontend Recommendations:"
echo "=========================="
echo "To prevent client disconnections after contract creation:"
echo "1. Handle navigation without full page refresh"
echo "2. Use React Router programmatic navigation instead of hard redirects"
echo "3. Update UI dynamically with real-time WebSocket events"
echo "4. Show success messages in modals/toasts"
echo "5. Implement WebSocket reconnection logic"

echo ""
echo "🧪 Testing Instructions:"
echo "======================"
echo "To verify the fix works properly:"
echo "1. Connect multiple clients (provider and tasker)"
echo "2. Create a contract through one client"
echo "3. Verify other clients receive WebSocket events"
echo "4. Confirm UI updates without page refresh"
echo "5. Check that no clients disconnect during the process"

echo ""
echo "🎉 WebSocket Integration Fix Applied Successfully!"
echo "==============================================="
echo "Your application will now emit real-time notifications after contract creation"
echo "Connected clients will receive updates without page refresh"
echo "Client disconnections after contract creation should be reduced"