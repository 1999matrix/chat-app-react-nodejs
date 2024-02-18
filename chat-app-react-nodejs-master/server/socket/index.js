const Message = require('../model/Message'); // Importing the Message model

// Function to initialize socket
const initSocket = (server, corsOptions) => {
  const io = require('socket.io')(server, { cors: corsOptions }); // Initializing socket.io with server and cors options

  let onlineUsers = []; // Array to store online users

  // Event listener for new connections
  io.on('connection', socket => {
    // Event listener for when a user comes online
    socket.on('USER_ONLINE', (userId, socketId) => {
      const userExisted = onlineUsers.some(user => user.userId === userId); // Check if user exists
      const prevSocketId = userExisted?.socketId || null; // Get previous socket id if user existed
      if (userExisted && prevSocketId !== socketId) { // If user existed and has different socket id
        onlineUsers = onlineUsers.map(user => user.userId === userId ? ({ ...user, socketId: socketId }) : user); // Update user's socket id
      } else if (!userExisted) { // If user is not already online
        onlineUsers.push({ userId, socketId: socketId }); // Add user to online users
        io.emit('ONLINE_USER_CHANGED', onlineUsers); // Emit event to inform clients about online user change
      }
    });

    // Event listener for when a user goes offline
    socket.on('USER_OFFLINE', (logoutUserId) => {
      onlineUsers = onlineUsers.filter(({ userId }) => userId !== logoutUserId); // Remove user from online users
      io.emit('ONLINE_USER_CHANGED', onlineUsers); // Emit event to inform clients about online user change
    });

    // Event listener for sending messages
    socket.on('SEND_MESSAGE', async (messageData) => {
      const { type, sender, receiver } = messageData; // Extract message data
      // Construct filter based on message type
      const filter = type === 'room' ? [receiver] : [sender, receiver];
      // Query message readers from database
      const messageReader = await Message
        .find()
        .all('users', filter)
        .select(['readers'])
        .sort({ createdAt: -1 })
        .lean();
      // Count unread messages
      const unreadCount = messageReader.filter(({ readers }) => readers.length === 0).length;
      // Get client id of receiver
      const clientId = type === 'user' ? onlineUsers.find(({ userId }) => userId === receiver)?.socketId : receiver;
      if (clientId) { // If client id is available
        // Emit event to notify receiver about new message
        socket.to(clientId).emit('RECEIVE_MESSAGE', { ...messageData, unreadCount });
      }
    });

    // Event listener for updating message status
    socket.on('UPDATE_MESSAGE_STATUS', ({ type, readerId, messageSender }) => {
      // Find socket id of message sender
      const socketId = type === 'room' 
        ? messageSender 
        : onlineUsers.find(({ userId }) => userId === messageSender)?.socketId;
      if (socketId) { // If socket id is available
        // Emit event to notify sender about message read status
        socket.to(socketId).emit('MESSAGE_READ', { type, readerId, messageSender });
      }
    });

    // Event listener for updating message readers
    socket.on('UPDATE_MESSAGE_READERS', ({ type, readerId, toId }) => {
      // Find socket id of message receiver
      const socketId = type === 'room' 
        ? toId 
        : onlineUsers.find(({ userId }) => userId === toId)?.socketId;
      if (socketId) { // If socket id is available
        // Emit event to notify receiver about message read status
        socket.to(socketId).emit('MESSAGE_READ', { type, readerId, toId });
      }
    });

    // Event listener for user typing status
    socket.on('USER_TYPING', ({ chatType, senderId, receiverId, typing, message }) => {
      if (chatType === 'room') { // If chat type is room
        // Emit event to notify room members about typing status
        socket.to(receiverId).emit('TYPING_NOTIFY', { chatType, senderId, receiverId, typing, message });
      } else { // If chat type is user
        const receiver = onlineUsers.find(({ userId }) => userId === receiverId); // Find receiver
        if (receiver) { // If receiver is online
          // Emit event to notify receiver about typing status
          socket.to(receiver.socketId).emit('TYPING_NOTIFY', { chatType, senderId, receiverId, typing, message });
        }
      }
    });

    // Event listener for entering chat room
    socket.on('ENTER_CHAT_ROOM', roomData => {
      const { roomId, message } = roomData; // Extract room data
      // Check if user is already in a room
      const currentRoom = Object.keys(socket.rooms).find(room => room !== socket.id);
      if (currentRoom === roomId) return; // If already in the requested room, do nothing
      if (currentRoom) { // If in another room
        socket.leave(currentRoom); // Leave current room
      }
      socket.join(roomId); // Join requested room
      // Emit event to notify room members about new user joining
      socket.to(roomId).emit('CHAT_ROOM_NOTIFY', {
        roomId,
        message
      });
    });

    // Event listener for leaving chat room
    socket.on('LEAVE_CHAT_ROOM', roomData => {
      const { roomId, message } = roomData; // Extract room data
      // Emit event to notify room members about user leaving
      socket.to(roomId).emit('CHAT_ROOM_NOTIFY', {
        roomId,
        message
      });
      socket.leave(roomId); // Leave room
    });
    
    // Event listener for room creation
    socket.on('ROOM_CREATED', ({ name, creator, invitedUser }) => {
      invitedUser.forEach(invitedUser => {
        const socketId = onlineUsers.find(({ userId }) => userId === invitedUser)?.socketId; // Find socket id of invited user
        if (socketId) { // If invited user is online
          // Emit event to notify invited user about room invitation
          socket.to(socketId).emit('INVITED_TO_ROOM', { message: `${creator} has added you to ${name} chat room`});
        }
      });
    });
  });
};

module.exports = {
  initSocket
};
