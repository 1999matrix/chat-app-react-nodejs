// Importing required models and libraries
const User = require('../model/User');
const Room = require('../model/Room');
const Message = require('../model/Message');
const asyncHandler = require('express-async-handler');

// Function to get unread message count
const getUnreadCount = asyncHandler(async (type, from, to) => {
  // Construct filter based on message type
  const filter = type === 'room' ? [to] : [from, to];
  // Query message readers from database
  const messageReaders = await Message
    .find({ sender: { $ne: from } }) // Excluding sender's own messages
    .all('users', filter)
    .select(['readers'])
    .sort({ createdAt: -1 })
    .lean();
  
  // Calculate unread message count
  return messageReaders.filter(({ readers }) => readers.indexOf(from) === -1).length || 0;
});

// Function to get latest message info
const getMessageInfo = asyncHandler(async(type, from, to) => {
  // Construct filter based on message type
  const filter = type === 'room' ? [to] : [from, to];
  // Query latest message from database
  const message = await Message
    .findOne()
    .all('users', filter)
    .select(['message', 'sender', 'updatedAt', 'readers'])
    .sort({ createdAt: -1 })
    .lean();

  // Get unread message count
  const unreadCount = await getUnreadCount(type, from, to);

  return {
    latestMessage: message?.message || null,
    latestMessageSender:  message?.sender || null,
    latestMessageUpdatedAt:  message?.updatedAt || null,
    unreadCount
  };
});

// Route handler to get user contacts
const getUserContacts = asyncHandler(async(req, res) => {
  try {
    const { userId } = req.params;

    // Validation check for required information
    if (!userId) return res.status(400).json({ message: 'Missing required information.' });

    // Query users and rooms from database
    const users = await User
      .find({ _id: { $ne: userId } }) // Excluding current user
      .select(['name', 'avatarImage', 'chatType'])
      .sort({ updatedAt: -1 })
      .lean();

    const rooms = await Room
      .find()
      .all('users', [userId])
      .select(['name', 'users', 'avatarImage', 'chatType'])
      .sort({ updatedAt: -1 })
      .lean();
      
    // Combine users and rooms
    const contacts = users.concat(rooms);
    // Get message info for each contact
    const contactWithMessages = await Promise.all(
      contacts.map(async(contact) => {
        const { _id, chatType: type } = contact;
        const messageInfo = await getMessageInfo(type, userId, _id.toHexString());

        return {
          ...contact,
          ...messageInfo
        };
      })
    );

    return res.status(200).json({ data: contactWithMessages });
  } catch(err) {
    return res.status(404).json({ message: err.message });
  }
});

// Route handler to get user messages
const getUserMessages = asyncHandler(async(req, res) => {
  try {
    const { userId } = req.params;
    const { type, chatId } = req.query;

    // Validation check for required information
    if (!userId || !type || !chatId) {
      return res.status(400).json({ message: 'Missing required information.' });
    }

    // Construct filter based on message type
    const filter = type === 'room' ? [chatId] : [userId, chatId];
    // Query messages from database
    const messages = await Message
      .find()
      .all('users', filter)
      .sort({ createdAt: 1 })
      .lean();
    
    // Get sender's avatar for each message
    const messagesWithAvatar = await Promise.all(
      messages.map(async(msg) => {
        const senderId = msg.sender;
        const user = await User.findById(senderId).lean();
        return {
          ...msg,
          avatarImage: user.avatarImage
        };
      })
    );

    return res.status(200).json({ data: messagesWithAvatar });
  } catch(err) {
    return res.status(404).json({ message: err.message });
  }
});

// Route handler to post a user message
const postUserMessage = asyncHandler(async(req, res) => {
  try {
    const { userId } = req.params;
    const { chatId } = req.query;
    const { message } = req.body;

    // Validation check for required information
    if (!userId || !chatId || !message) {
      return res.status(400).json({ message: 'Missing required information.' });
    }

    // Create new message
    const newMessage = await Message.create({
      message,
      users: [userId, chatId],
      sender: userId,
      readers: []
    });

    return res.status(200).json({ data: newMessage });

  } catch(err) {
    return res.status(500).json({ message: err.message });
  }
});

// Route handler to post a room
const postRoom = asyncHandler(async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { name, users,  avatarImage } = req.body;

    // Validation check for required information
    if (!userId || !name || !users || !avatarImage) {
      return res.status(400).json({ message: 'Missing required information.' });
    }

    // Create new room
    const data = await Room.create({
      name,
      users: [...users, userId],
      avatarImage,
      chatType: 'room'
    });

    return res.json({ data, messages: 'Successfully created a room.' });

  } catch(err) {
    return res.status(500).json({ message: e.message });
  }
});

// Route handler to update message read status
const updateMessageReadStatus = asyncHandler(async (req, res) => {
  try {
    // Update message read status
    const { userId } = req.params;
    const { type, chatId } = req.query;

    // Validation check for required information
    if (!userId || !type || !chatId) {
      return res.status(400).json({ message: 'Missing required information.' });
    }

    const filter = type === 'room' ? [chatId] : [userId, chatId];

    // Query messages where sender is not the user
    const messages = await Message
      .find({ sender: { $ne: userId }})
      .all('users', filter)
      .sort({ createdAt: 1 });

    // Create message-reader map
    const messageReaderMap = messages.reduce((prev, curr) => {
      return {...prev, [curr._id.toHexString()]: curr.readers };
    }, {});

    // Check if user already exists in readers, if not, add them
    Object.entries(messageReaderMap).forEach(([key, value]) => {
      const userHasRead  = value.indexOf(userId) > -1;
      if (!userHasRead) {
        messageReaderMap[key].push(userId); // If not read yet, add the user
      }
    });
    
    // Update read status for messages
    await Promise.all(
      Object.keys(messageReaderMap).map(async (msgId) => {
        return await Message
              .findByIdAndUpdate({ _id: msgId }, { readers: messageReaderMap[msgId] }, { new: true } )
              .lean();
      })
    );
    
    return res.status(200).json({ data: null, message: 'Successfully updated.'});
  } catch(err) {
    return res.status(500).json({ message: err.message });
  }
  });
  
  module.exports = {
    getUserContacts,
    getUserMessages,
    postUserMessage,
    postRoom,
    updateMessageReadStatus
  };
