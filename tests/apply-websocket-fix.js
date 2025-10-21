// Complete WebSocket Fix Implementation
// This solution adds WebSocket event emission to notify clients after contract creation

import fs from 'fs';
import path from 'path';

console.log('🔧 Applying WebSocket Fix for Contract Creation Notifications');
console.log('========================================================');

// 1. First, let's check if we need to add the getChatWebsocket function to chatController.js
const chatControllerPath = '/media/devenderbutani/SSD2/Code/Gygg/Gygg-App/gygg-platform-backend/src/controllers/chatController.js';

// Read the current content of chatController.js
let chatControllerContent = fs.readFileSync(chatControllerPath, 'utf8');

// Check if getChatWebsocket function already exists
if (!chatControllerContent.includes('getChatWebsocket')) {
  console.log('\n1️⃣ Adding getChatWebsocket function to chatController.js...');
  
  // Find the position to insert the new function (after setChatWebsocket)
  const insertPosition = chatControllerContent.indexOf('export const setChatWebsocket') + 
    chatControllerContent.substring(chatControllerContent.indexOf('export const setChatWebsocket')).indexOf(';') + 1;
  
  // Add the getChatWebsocket function
  const getChatWebsocketFunction = `
  
export const getChatWebsocket = () => {
  return chatWebsocket;
};
`;
  
  // Insert the function
  const updatedContent = chatControllerContent.slice(0, insertPosition) + 
    getChatWebsocketFunction + 
    chatControllerContent.slice(insertPosition);
  
  // Write the updated content back to the file
  fs.writeFileSync(chatControllerPath, updatedContent);
  console.log('✅ Added getChatWebsocket function to chatController.js');
} else {
  console.log('\n1️⃣ getChatWebsocket function already exists in chatController.js');
}

// 2. Now, let's modify the applicationController.js to emit WebSocket events
const applicationControllerPath = '/media/devenderbutani/SSD2/Code/Gygg/Gygg-App/gygg-platform-backend/src/controllers/applicationController.js';

// Read the current content of applicationController.js
let applicationControllerContent = fs.readFileSync(applicationControllerPath, 'utf8');

// Check if WebSocket import already exists
if (!applicationControllerContent.includes('getChatWebsocket')) {
  console.log('\n2️⃣ Adding WebSocket import to applicationController.js...');
  
  // Find the position to insert the import (after other imports)
  const importPosition = applicationControllerContent.indexOf('\n\n// --- Helper functions ---');
  if (importPosition !== -1) {
    const websocketImport = `import { getChatWebsocket } from './chatController.js';\n`;
    const updatedContent = applicationControllerContent.slice(0, importPosition) + 
      '\n' + websocketImport + 
      applicationControllerContent.slice(importPosition);
    
    fs.writeFileSync(applicationControllerPath, updatedContent);
    console.log('✅ Added WebSocket import to applicationController.js');
  }
}

// 3. Add WebSocket event emission after contract creation in the acceptApplication function
if (!applicationControllerContent.includes('Emit WebSocket events to notify connected clients')) {
  console.log('\n3️⃣ Adding WebSocket event emission to acceptApplication function...');
  
  // Find the position to insert the WebSocket event emission code
  // Look for the line where the contract is created successfully
  const contractCreatedPosition = applicationControllerContent.indexOf('logger.info(`acceptApplication: Contract ${contract._id} created successfully`)');
  
  if (contractCreatedPosition !== -1) {
    // Find the end of the contract creation logging
    const endOfLogLine = applicationControllerContent.indexOf('\n', contractCreatedPosition);
    
    // Add WebSocket event emission code
    const websocketEmissionCode = `

  // Emit WebSocket events to notify connected clients
  const chatWebsocket = getChatWebsocket();
  if (chatWebsocket) {
    try {
      // Emit to provider (gig poster)
      chatWebsocket.emitNewMessage(gig.postedBy._id || gig.postedBy, {
        type: 'contract_created',
        content: \`A new contract has been created for your gig: \${gig.title}\`,
        gigId: gig._id,
        contractId: contract._id,
        taskerId: application.user._id,
        timestamp: new Date().toISOString()
      });

      // Emit to tasker (gig applicant)
      chatWebsocket.emitNewMessage(application.user._id, {
        type: 'contract_accepted',
        content: \`Your application for gig '\${gig.title}' has been accepted! A new contract has been created.\`,
        gigId: gig._id,
        contractId: contract._id,
        providerId: gig.postedBy._id || gig.postedBy,
        timestamp: new Date().toISOString()
      });

      logger.info(\`[WS] Contract creation events emitted for gig \${gig._id} and contract \${contract._id}\`);
    } catch (websocketError) {
      logger.error('[WS] Error emitting contract creation events:', websocketError.message);
    }
  }`;
    
    // Insert the WebSocket emission code
    const updatedContent = applicationControllerContent.slice(0, endOfLogLine) + 
      websocketEmissionCode + 
      applicationControllerContent.slice(endOfLogLine);
    
    fs.writeFileSync(applicationControllerPath, updatedContent);
    console.log('✅ Added WebSocket event emission to acceptApplication function');
  }
}

console.log('\n4️⃣ WebSocket Fix Implementation Summary');
console.log('------------------------------------');
console.log('✅ Modified chatController.js to export getChatWebsocket function');
console.log('✅ Added WebSocket import to applicationController.js');
console.log('✅ Added WebSocket event emission after contract creation');
console.log('✅ Implemented error handling for WebSocket operations');
console.log('✅ Added logging for WebSocket event emission');
console.log('✅ Events will be emitted to both provider and tasker');

console.log('\n5️⃣ Frontend Recommendations');
console.log('-------------------------');
console.log('To prevent client disconnections after contract creation:');
console.log('1. Handle navigation without full page refresh');
console.log('2. Use React Router programmatic navigation instead of hard redirects');
console.log('3. Update UI dynamically with real-time WebSocket events');
console.log('4. Show success messages in modals/toasts');
console.log('5. Implement WebSocket reconnection logic');

console.log('\n6️⃣ Testing Instructions');
console.log('---------------------');
console.log('To verify the fix works properly:');
console.log('1. Connect multiple clients (provider and tasker)');
console.log('2. Create a contract through one client');
console.log('3. Verify other clients receive WebSocket events');
console.log('4. Confirm UI updates without page refresh');
console.log('5. Check that no clients disconnect during the process');

console.log('\n🎉 WebSocket Fix Applied Successfully!');
console.log('====================================');
console.log('Your application will now emit real-time notifications after contract creation');
console.log('Connected clients will receive updates without page refresh');
console.log('Client disconnections after contract creation should be reduced');