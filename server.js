import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { GoogleGenAI } from "@google/genai";
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import { tmpdir } from 'os';
import { promisify } from 'util';
import { pipeline } from 'stream';
import { createWriteStream } from 'fs';
const streamPipeline = promisify(pipeline);

async function downloadPDFToTempFile(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch PDF document: ${response.status}`);
  }

  const tempFilePath = join(tmpdir(), `document_${Date.now()}.pdf`);
  await streamPipeline(response.body, createWriteStream(tempFilePath));
  return tempFilePath;
}


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3001;

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true
}));
app.use(express.json());

// Authentication middleware
const authenticateRequest = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const expectedToken = '45fcaee7dd6ff1411c28cc03b33d88c6354945fd787c5f239da3fadc5d9ec734';
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Missing or invalid authorization header',
      success: false
    });
  }
  
  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  
  if (token !== expectedToken) {
    return res.status(401).json({
      error: 'Invalid authorization token',
      success: false
    });
  }
  
  next();
};

// Helper function to calculate cosine similarity
function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  
  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }
  
  return dotProduct / (magnitudeA * magnitudeB);
}

// Function to process document from URL and answer questions Level-0
// async function processDocumentWithQuestions(documentUrl, questions) {
//   try {
//     console.log(`Processing document from URL: ${documentUrl}`);
//     console.log(`Number of questions: ${questions.length}`);
    
//     // Step 1: Validate and load document from URL
//     if (!documentUrl || (!documentUrl.startsWith('http://') && !documentUrl.startsWith('https://'))) {
//       throw new Error('Invalid document URL provided');
//     }

//     // Check if URL is accessible
//     try {
//       const response = await fetch(documentUrl, { method: 'HEAD' });
//       if (!response.ok) {
//         throw new Error(`Document URL is not accessible. Status: ${response.status}`);
//       }
//     } catch (fetchError) {
//       throw new Error(`Failed to access document URL: ${fetchError.message}`);
//     }

//     // Load document
//     console.log('Loading PDF document...');
//     let rawDocs;
    
//     try {
//       const filePath = await downloadPDFToTempFile(documentUrl);
//       const pdfLoader = new PDFLoader(filePath);
//       rawDocs = await pdfLoader.load();

//       fs.unlink(filePath, (err) => {
//   if (err) console.warn('Failed to delete temp PDF:', err);
// });
//     } catch (loadError) {
//       throw new Error(`Failed to load PDF document: ${loadError.message}`);
//     }

//     if (!rawDocs || rawDocs.length === 0) {
//       throw new Error('No content could be extracted from the document');
//     }

//     console.log(`Document loaded successfully. Pages: ${rawDocs.length}`);
//     console.log(`Total content length: ${rawDocs.reduce((total, doc) => total + doc.pageContent.length, 0)} characters`);

//     // Step 2: Split document into chunks
//     console.log('Splitting document into chunks...');
//     const textSplitter = new RecursiveCharacterTextSplitter({
//       chunkSize: 1000,
//       chunkOverlap: 200,
//     });

//     const chunkedDocs = await textSplitter.splitDocuments(rawDocs);
//     console.log(`Document split into ${chunkedDocs.length} chunks`);

//     // Step 3: Create embeddings for chunks
//     console.log('Creating embeddings for document chunks...');
//     const embeddings = new GoogleGenerativeAIEmbeddings({
//       apiKey: process.env.GEMINI_API_KEY,
//       model: "text-embedding-004",
//     });

//     const chunkEmbeddings = await Promise.all(
//       chunkedDocs.map(async (doc, index) => {
//         console.log(`Processing chunk ${index + 1}/${chunkedDocs.length}`);
//         const embedding = await embeddings.embedQuery(doc.pageContent);
//         return {
//           content: doc.pageContent,
//           embedding: embedding,
//           metadata: doc.metadata
//         };
//       })
//     );

//     // Step 4: Process each question
//     const answers = [];
    
//     for (let i = 0; i < questions.length; i++) {
//       const question = questions[i];
//       console.log(`Processing question ${i + 1}/${questions.length}: ${question}`);
      
//       try {
//         // Create query embedding
//         const queryVector = await embeddings.embedQuery(question);
        
//         // Calculate similarity scores and get top matches
//         const similarities = chunkEmbeddings.map((chunk, index) => {
//           const similarity = cosineSimilarity(queryVector, chunk.embedding);
//           return {
//             content: chunk.content,
//             similarity: similarity,
//             metadata: chunk.metadata,
//             chunkIndex: index
//           };
//         });

//         // Sort by similarity and get top 5
//         const topMatches = similarities
//           .sort((a, b) => b.similarity - a.similarity)
//           .slice(0, 5);

//         console.log(`Found top similarities for question ${i + 1}:`, topMatches.map(m => m.similarity.toFixed(4)));

//         const context = topMatches
//           .map((match, index) => `[Chunk ${match.chunkIndex + 1}]: ${match.content}`)
//           .join("\n\n---\n\n");

//         // Generate answer using Gemini
//         const response = await ai.models.generateContent({
//           model: "gemini-2.0-flash",
//           contents: [
//             {
//               role: "user",
//               parts: [{
//                 text: `
// You are an expert insurance policy analyzer. Based on the provided context from the policy document, answer the specific question clearly and concisely.

// Context from the policy document:
// ${context}

// Question:
// ${question}

// Instructions:
// 1. Answer based STRICTLY on the information provided in the context
// 2. Be specific and cite relevant policy clauses or sections when applicable
// 3. If the exact information is not found in the context, state "The specific information is not clearly stated in the provided document sections"
// 4. Keep the answer concise but complete
// 5. Focus on factual information from the policy

// Answer:
// `
//               }],
//             },
//           ],
//           config: {
//             systemInstruction: `
// You are an expert assistant for insurance policy analysis.
// Base your answers strictly on the provided policy document context.
// Be precise, factual, and avoid speculation.
// Reference specific policy terms and conditions when available.
//             `,
//           },
//         });

//         const answer = response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "No response generated";
//         answers.push(answer);
        
//         console.log(`Answer ${i + 1} generated successfully`);
        
//         // Add small delay to avoid rate limiting
//         if (i < questions.length - 1) {
//           await new Promise(resolve => setTimeout(resolve, 500));
//         }
        
//       } catch (questionError) {
//         console.error(`Error processing question ${i + 1}:`, questionError);
//         answers.push(`Error processing question: ${questionError.message}`);
//       }
//     }
    
//     return answers;
    
//   } catch (error) {
//     console.error('Error in processDocumentWithQuestions:', error);
//     throw error;
//   }
// }

// Level-1
async function processDocumentWithQuestions(documentUrl, questions) {
  try {
    console.log(`Processing document from URL: ${documentUrl}`);
    console.log(`Number of questions: ${questions.length}`);
    
    // Step 1: Validate and load document from URL
    if (!documentUrl || (!documentUrl.startsWith('http://') && !documentUrl.startsWith('https://'))) {
      throw new Error('Invalid document URL provided');
    }

    // Check if URL is accessible
    try {
      const response = await fetch(documentUrl, { method: 'HEAD' });
      if (!response.ok) {
        throw new Error(`Document URL is not accessible. Status: ${response.status}`);
      }
    } catch (fetchError) {
      throw new Error(`Failed to access document URL: ${fetchError.message}`);
    }

    // Load document
    console.log('Loading PDF document...');
    let rawDocs;
    try {
      const filePath = await downloadPDFToTempFile(documentUrl);
      const pdfLoader = new PDFLoader(filePath);
      rawDocs = await pdfLoader.load();

      // delete temp file
      fs.unlink(filePath, (err) => {
        if (err) console.warn('Failed to delete temp PDF:', err);
      });
    } catch (loadError) {
      throw new Error(`Failed to load PDF document: ${loadError.message}`);
    }

    if (!rawDocs || rawDocs.length === 0) {
      throw new Error('No content could be extracted from the document');
    }

    console.log(`Document loaded successfully. Pages: ${rawDocs.length}`);
    console.log(`Total content length: ${rawDocs.reduce((total, doc) => total + doc.pageContent.length, 0)} characters`);

    // Step 2: Split document into chunks
    console.log('Splitting document into chunks...');
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    const chunkedDocs = await textSplitter.splitDocuments(rawDocs);
    console.log(`Document split into ${chunkedDocs.length} chunks`);

    // Step 3: Create embeddings for chunks
    console.log('Creating embeddings for document chunks...');
    const embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: process.env.GEMINI_API_KEY,
      model: "text-embedding-004",
    });

    const chunkEmbeddings = await Promise.all(
      chunkedDocs.map(async (doc, index) => {
        console.log(`Processing chunk ${index + 1}/${chunkedDocs.length}`);
        const embedding = await embeddings.embedQuery(doc.pageContent);
        return {
          content: doc.pageContent,
          embedding: embedding,
          metadata: doc.metadata
        };
      })
    );

    // Step 4: Process each question
    const answers = [];
    
    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      console.log(`Processing question ${i + 1}/${questions.length}: ${question}`);
      
      try {
        // Create query embedding
        const queryVector = await embeddings.embedQuery(question);
        
        // Calculate similarity scores and get top matches
        const similarities = chunkEmbeddings.map((chunk, index) => {
          const similarity = cosineSimilarity(queryVector, chunk.embedding);
          return {
            content: chunk.content,
            similarity: similarity,
            metadata: chunk.metadata,
            chunkIndex: index
          };
        });

        // Sort by similarity and get top 5
        const topMatches = similarities
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 5);

        console.log(`Top similarities for question ${i + 1}:`, topMatches.map(m => m.similarity.toFixed(4)));

        const context = topMatches
          .map(match => match.content)
          .join("\n\n---\n\n");

        // Generate clean answer using Gemini
        const response = await ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: [
            {
              role: "user",
              parts: [{
                text: `
You are an expert insurance policy analyzer.

Context from the policy document:
${context}

Question:
${question}

Instructions:
1. Provide a clear, concise, self-contained answer in plain language.
2. Do NOT include section numbers, chunk references, or raw policy text unless essential for meaning.
3. If the answer is not in the provided context, respond exactly with:
"The specific information is not clearly stated in the provided document sections."
4. Your answer should be a single sentence or short paragraph.
5. Return only the answer text with no extra commentary or formatting.
                `
              }],
            },
          ],
          config: {
            systemInstruction: `
Only return the final answer text exactly as instructed.
Do not include reasoning steps, citations, or extra formatting.
If answer not found, use the exact fallback sentence.
            `,
          },
        });
//         const response = await openai.chat.completions.create({
//           model: "gpt-4o-mini",
//           messages: [
//             {
//               role: "user",
//               content: `
// You are an expert insurance policy analyzer.

// Context from the policy document:
// ${context}

// Question:
// ${question}

// Instructions:
// 1. Provide a clear, concise, self-contained answer in plain language.
// 2. Do NOT include section numbers, chunk references, or raw policy text unless essential for meaning.
// 3. If the answer is not in the provided context, respond exactly with:
// "The specific information is not clearly stated in the provided document sections."
// 4. Your answer should be a single sentence or short paragraph.
// 5. Return only the answer text with no extra commentary or formatting.
//                 `
//             }
//           ]
//         });

        const answer = response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
          || "The specific information is not clearly stated in the provided document sections.";

        answers.push(answer);
        
        console.log(`Answer ${i + 1} generated successfully`);
        
        // small delay to avoid rate limiting
        if (i < questions.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        
      } catch (questionError) {
        console.error(`Error processing question ${i + 1}:`, questionError);
        answers.push(`Error processing question: ${questionError.message}`);
      }
    }
    
    // Return in your desired JSON format
    return { answers };
    
  } catch (error) {
    console.error('Error in processDocumentWithQuestions:', error);
    throw error;
  }
}

// Level-2 for streaming
// async function processDocumentWithQuestionsStream(documentUrl, questions, res) {
//   console.log(`Processing document: ${documentUrl}`);
  
//   // 1️⃣ Load & prepare the document once
//   const documentData = await loadDocument(documentUrl);
//   const contextText = documentData.text || ''; // Plain text content
  
//   // 2️⃣ Build the combined prompt
//   const combinedPrompt = `
// You are given a document. Answer all questions strictly based on it.

// DOCUMENT:
// """
// ${contextText}
// """

// QUESTIONS:
// ${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

// Return ONLY a JSON object in this format:
// {
//   "answers": [
//     { "question": "<question text>", "answer": "<answer>" },
//     ...
//   ]
// }
// `;

//   // 3️⃣ Create streaming completion
//   const stream = await openai.chat.completions.create({
//     model: "gpt-4o-mini",
//     messages: [{ role: "user", content: combinedPrompt }],
//     temperature: 0,
//     stream: true // Enable streaming
//   });

//   let fullContent = '';
  
//   // 4️⃣ Process the stream
//   for await (const chunk of stream) {
//     const content = chunk.choices[0]?.delta?.content || '';
    
//     if (content) {
//       fullContent += content;
      
//       // Send chunk to client
//       res.write(`data: ${JSON.stringify({
//         type: 'chunk',
//         content: content,
//         timestamp: new Date().toISOString()
//       })}\n\n`);
//     }
//   }

//   // 5️⃣ Parse the complete JSON and send final result
//   let answers;
//   try {
//     answers = JSON.parse(fullContent);
    
//     // Send the final parsed result
//     res.write(`data: ${JSON.stringify({
//       type: 'complete',
//       data: answers,
//       timestamp: new Date().toISOString()
//     })}\n\n`);
    
//   } catch (e) {
//     // Send error if JSON parsing fails
//     res.write(`data: ${JSON.stringify({
//       type: 'error',
//       error: 'Model returned invalid JSON',
//       rawContent: fullContent,
//       timestamp: new Date().toISOString()
//     })}\n\n`);
//     throw new Error("Model returned invalid JSON");
//   }

//   return answers;
// }




// Main HackRX API endpoint Level - 0
// app.post('/api/v1/hackrx/run', authenticateRequest, async (req, res) => {
//   try {
//     console.log(`[${new Date().toISOString()}] Received HackRX request`);
//     console.log('Request body:', JSON.stringify(req.body, null, 2));
    
//     const { documents, questions } = req.body;
    
//     // Validate request
//     if (!documents) {
//       return res.status(400).json({
//         error: 'Missing required field: documents',
//         success: false
//       });
//     }
    
//     if (!questions || !Array.isArray(questions) || questions.length === 0) {
//       return res.status(400).json({
//         error: 'Missing required field: questions (must be a non-empty array)',
//         success: false
//       });
//     }
    
//     // Validate document URL
//     if (typeof documents !== 'string') {
//       return res.status(400).json({
//         error: 'Documents field must be a string URL',
//         success: false
//       });
//     }
    
//     // Process the document and answer questions
//     console.log('Starting document processing...');
//     const answers = await processDocumentWithQuestions(documents, questions);
    
//     console.log('Document processing completed successfully');
//     console.log(`Generated ${answers.length} answers`);
    
//     // Return response in the expected format
//     // const response = {
//     //   answers: answers
//     // };
    
//     // res.json(response);

//     const output = await processDocumentWithQuestions(documents[0], questions);
// res.json(output);
    
//   } catch (error) {
//     console.error('Error in /hackrx/run endpoint:', error);
//     res.status(500).json({
//       error: 'Internal server error',
//       message: error.message,
//       success: false
//     });
//   }
// });

// Level - 1 with updated answer
app.post('/api/v1/hackrx/run', authenticateRequest, async (req, res) => {
  try {
    console.log(`[${new Date().toISOString()}] Received HackRX request`);
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const { documents, questions } = req.body;

    // Validate request
    if (!documents || typeof documents !== 'string') {
      return res.status(400).json({
        error: 'Documents field must be a non-empty string URL',
        success: false
      });
    }

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({
        error: 'Questions must be a non-empty array',
        success: false
      });
    }

    // Process the document and answer questions
    console.log('Starting document processing...');
    const output = await processDocumentWithQuestions(documents, questions);
    console.log('Document processing completed successfully');

    // Return in expected format
    res.json(output);

  } catch (error) {
    console.error('Error in /hackrx/run endpoint:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      success: false
    });
  }
});


// Level - 2 with streaming responses
// app.post('/api/v1/hackrx/run', authenticateRequest, async (req, res) => {
//   try {
//     console.log(`[${new Date().toISOString()}] Received HackRX request`);
//     console.log('Request body:', JSON.stringify(req.body, null, 2));

//     const { documents, questions } = req.body;

//     // Validate request
//     if (!documents || typeof documents !== 'string') {
//       return res.status(400).json({
//         error: 'Documents field must be a non-empty string URL',
//         success: false
//       });
//     }

//     if (!questions || !Array.isArray(questions) || questions.length === 0) {
//       return res.status(400).json({
//         error: 'Questions must be a non-empty array',
//         success: false
//       });
//     }

//     // Set up Server-Sent Events headers
//     res.writeHead(200, {
//       'Content-Type': 'text/event-stream',
//       'Cache-Control': 'no-cache',
//       'Connection': 'keep-alive',
//       'Access-Control-Allow-Origin': '*',
//       'Access-Control-Allow-Headers': 'Cache-Control'
//     });

//     // Send initial status
//     res.write(`data: ${JSON.stringify({
//       type: 'status',
//       message: 'Starting document processing...',
//       timestamp: new Date().toISOString()
//     })}\n\n`);

//     // Process the document and stream responses
//     console.log('Starting document processing...');
//     const output = await processDocumentWithQuestionsStream(documents, questions, res);
//     console.log('Document processing completed successfully');

//     // End the stream
//     res.write(`data: ${JSON.stringify({
//       type: 'end',
//       message: 'Processing completed',
//       timestamp: new Date().toISOString()
//     })}\n\n`);
    
//     res.end();

//   } catch (error) {
//     console.error('Error in /hackrx/run endpoint:', error);
    
//     // Send error through stream if headers already sent
//     if (res.headersSent) {
//       res.write(`data: ${JSON.stringify({
//         type: 'error',
//         error: 'Internal server error',
//         message: error.message,
//         timestamp: new Date().toISOString()
//       })}\n\n`);
//       res.end();
//     } else {
//       // Fall back to regular JSON error response
//       res.status(500).json({
//         error: 'Internal server error',
//         message: error.message,
//         success: false
//       });
//     }
//   }
// });




// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'HackRX API Server is running',
    timestamp: new Date().toISOString(),
    endpoints: [
      'POST /hackrx/run - Main document processing endpoint'
    ]
  });
});

// Status endpoint
app.get('/status', (req, res) => {
  res.json({
    status: 'OK',
    environment: {
      gemini_configured: !!process.env.GEMINI_API_KEY,
      port: PORT
    },
    supported_formats: ['PDF via URL'],
    authentication: 'Bearer token required',
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
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
    available_endpoints: [
      'POST /hackrx/run',
      'GET /health',
      'GET /status'
    ],
    success: false
  });
});

app.listen(PORT, () => {
  console.log(`HackRX API Server is running on http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log('- POST /hackrx/run (requires Bearer token authentication)');
  console.log('- GET /health');
  console.log('- GET /status');
  console.log('\nReady to process PDF documents from URLs with multiple questions!');
});