import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import { chatting, processUploadedDocument } from './query.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import multer from 'multer';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3001;

console.log(process.env.FRONTEND_URL)

// Create uploads directory if it doesn't exist
const uploadsDir = join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + '.' + file.originalname.split('.').pop());
  }
});

// File filter to accept only specific file types
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['application/pdf', 'text/plain', 'application/msword', 
                       'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  
  if (allowedTypes.includes(file.mimetype) || file.originalname.toLowerCase().endsWith('.pdf')) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, DOC, DOCX, and TXT files are allowed.'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:5173', process.env.FRONTEND_URL],
  credentials: true,
  httpsOnly: true
}));
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'RAG Backend Server is running',
    timestamp: new Date().toISOString()
  });
});

// Chat endpoint for RAG queries (existing)
app.post('/api/chat', async (req, res) => {
  try {
    const { message, question } = req.body;
    
    if (!message && !question) {
      return res.status(400).json({
        error: 'Missing required field: message or question',
        success: false
      });
    }

    const userQuery = message || question;
    
    console.log(`[${new Date().toISOString()}] Processing query:`, userQuery);
    
    let originalLog = console.log;
    let capturedOutput = '';
    
    console.log = (...args) => {
      capturedOutput += args.join(' ') + '\n';
      originalLog(...args);
    };

    await chatting(userQuery);
    
    console.log = originalLog;
    
    const answerMatch = capturedOutput.match(/✅ Answer:\s*(.*)/s);
    const answer = answerMatch ? answerMatch[1].trim() : 'No response generated';
    
    let parsedResponse;
    try {
      const jsonMatch = answer.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      parsedResponse = { response: answer };
    }

    res.json({
      success: true,
      query: userQuery,
      answer: answer,
      structured_response: parsedResponse,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error processing chat request:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      success: false
    });
  }
});

// NEW ENDPOINT: Process uploaded document with query
app.post('/api/document/upload', upload.single('document'), async (req, res) => {
  try {
    const { query, message, question } = req.body;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({
        error: 'No document file uploaded',
        success: false
      });
    }

    if (!query && !message && !question) {
      // Clean up uploaded file
      fs.unlinkSync(file.path);
      return res.status(400).json({
        error: 'Missing required field: query, message, or question',
        success: false
      });
    }

    const userQuery = query || message || question;
    
    console.log(`[${new Date().toISOString()}] Processing uploaded document: ${file.originalname}`);
    console.log(`[${new Date().toISOString()}] Query: ${userQuery}`);
    
    let originalLog = console.log;
    let capturedOutput = '';
    
    console.log = (...args) => {
      capturedOutput += args.join(' ') + '\n';
      originalLog(...args);
    };

    const answer = await processUploadedDocument(file.path, userQuery);
    
    console.log = originalLog;
    
    // Clean up uploaded file after processing
    try {
      fs.unlinkSync(file.path);
    } catch (cleanupError) {
      console.warn('Failed to clean up uploaded file:', cleanupError.message);
    }
    
    let parsedResponse;
    try {
      const jsonMatch = answer.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      parsedResponse = { response: answer };
    }

    res.json({
      success: true,
      uploaded_file: file.originalname,
      file_size: file.size,
      query: userQuery,
      answer: answer,
      structured_response: parsedResponse,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error processing uploaded document:', error);
    
    // Clean up uploaded file in case of error
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.warn('Failed to clean up uploaded file after error:', cleanupError.message);
      }
    }
    
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      success: false
    });
  }
});

// Insurance claim evaluation endpoint (existing)
app.post('/api/v1/hackrx/run', async (req, res) => {
  try {
    const { 
      age, 
      gender, 
      procedure, 
      location, 
      policyDuration,
      customQuery 
    } = req.body;

    let query;
    
    if (customQuery) {
      query = customQuery;
    } else {
      if (!age || !gender || !procedure) {
        return res.status(400).json({
          error: 'Missing required fields: age, gender, and procedure are required',
          success: false
        });
      }
      
      query = `${age}${gender}, ${procedure}`;
      if (location) query += `, ${location}`;
      if (policyDuration) query += `, ${policyDuration} policy`;
    }

    console.log(`[${new Date().toISOString()}] Evaluating claim:`, query);
    
    let originalLog = console.log;
    let capturedOutput = '';
    
    console.log = (...args) => {
      capturedOutput += args.join(' ') + '\n';
      originalLog(...args);
    };

    await chatting(query);
    
    console.log = originalLog;
    
    const answerMatch = capturedOutput.match(/✅ Answer:\s*(.*)/s);
    const answer = answerMatch ? answerMatch[1].trim() : 'No response generated';
    
    let claimResult;
    try {
      const jsonMatch = answer.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        claimResult = JSON.parse(jsonMatch[0]);
      } else {
        claimResult = {
          Decision: 'Unknown',
          Amount: null,
          Justification: answer
        };
      }
    } catch (e) {
      claimResult = {
        Decision: 'Error',
        Amount: null,
        Justification: answer
      };
    }

    res.json({
      success: true,
      query: query,
      result: claimResult,
      raw_response: answer,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error evaluating claim:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      success: false
    });
  }
});

// NEW ENDPOINT: Insurance claim evaluation with uploaded document
app.post('/api/v1/hackrx/run-with-upload', upload.single('document'), async (req, res) => {
  try {
    const { 
      age, 
      gender, 
      procedure, 
      location, 
      policyDuration,
      customQuery 
    } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        error: 'No document file uploaded',
        success: false
      });
    }

    let query;
    
    if (customQuery) {
      query = customQuery;
    } else {
      if (!age || !gender || !procedure) {
        // Clean up uploaded file
        fs.unlinkSync(file.path);
        return res.status(400).json({
          error: 'Missing required fields: age, gender, and procedure are required',
          success: false
        });
      }
      
      query = `${age}${gender}, ${procedure}`;
      if (location) query += `, ${location}`;
      if (policyDuration) query += `, ${policyDuration} policy`;
    }

    console.log(`[${new Date().toISOString()}] Processing uploaded document: ${file.originalname}`);
    console.log(`[${new Date().toISOString()}] Evaluating claim: ${query}`);
    
    const answer = await processUploadedDocument(file.path, query);
    
    // Clean up uploaded file after processing
    try {
      fs.unlinkSync(file.path);
    } catch (cleanupError) {
      console.warn('Failed to clean up uploaded file:', cleanupError.message);
    }
    
    let claimResult;
    try {
      const jsonMatch = answer.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        claimResult = JSON.parse(jsonMatch[0]);
      } else {
        claimResult = {
          Decision: 'Unknown',
          Amount: null,
          Justification: answer
        };
      }
    } catch (e) {
      claimResult = {
        Decision: 'Error',
        Amount: null,
        Justification: answer
      };
    }

    res.json({
      success: true,
      uploaded_file: file.originalname,
      file_size: file.size,
      query: query,
      result: claimResult,
      raw_response: answer,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error evaluating claim with uploaded document:', error);
    
    // Clean up uploaded file in case of error
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.warn('Failed to clean up uploaded file after error:', cleanupError.message);
      }
    }
    
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      success: false
    });
  }
});

// Get environment status
app.get('/api/status', (req, res) => {
  res.json({
    status: 'OK',
    environment: {
      gemini_configured: !!process.env.GEMINI_API_KEY,
      pinecone_configured: !!process.env.PINECONE_INDEX_NAME,
      pinecone_api_configured: !!process.env.PINECONE_API_KEY
    },
    upload_config: {
      max_file_size: '10MB',
      allowed_types: ['PDF', 'DOC', 'DOCX', 'TXT'],
      upload_directory: uploadsDir
    },
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  
  // Handle multer errors
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large. Maximum size is 10MB.',
        success: false
      });
    }
    return res.status(400).json({
      error: `Upload error: ${err.message}`,
      success: false
    });
  }
  
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
    success: false
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    success: false
  });
});

app.listen(PORT, () => {
  console.log(`Backend Server is running on http://localhost:${PORT}`);
  console.log(`Upload directory: ${uploadsDir}`);
});