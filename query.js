import * as dotenv from 'dotenv';
dotenv.config();
import readlineSync from 'readline-sync';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { Pinecone } from '@pinecone-database/pinecone';
import { GoogleGenAI } from "@google/genai";
import { WebPDFLoader } from '@langchain/community/document_loaders/web/pdf';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { TextLoader } from "langchain/document_loaders/fs/text";
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import fetch from 'node-fetch';
import path from 'path';

const ai = new GoogleGenAI({});
const History = [];

async function transformQuery(question) {
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [
      {
        role: "user",
        parts: [{ text: question }]
      }
    ],
    config: {
      systemInstruction: `
You are a query rewriting expert for an insurance claim system. 
If the user provides a shorthand query with details like age, gender, procedure, location, or policy duration, 
expand it into a complete, standalone insurance-related question.

For example:
"46M, knee surgery, Pune, 3-month policy"
→ "A 46-year-old male with a 3-month-old Easy Health Policy in Pune needs knee surgery. 
Will the expenses be covered under the policy, and what clauses apply?"

Only output the rewritten question.
`,
    },
  });

  const rewritten =
    response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || question;

  return rewritten;
}

export async function chatting(question) {
  try {
    // Step 1: Rewrite query
    const queries = await transformQuery(question);

    // Step 2: Create embeddings
    const embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: process.env.GEMINI_API_KEY,
      model: "text-embedding-004",
    });

    const queryVector = await embeddings.embedQuery(queries);

    // Step 3: Search Pinecone
    const pinecone = new Pinecone();
    const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME);

    const searchResults = await pineconeIndex.query({
      topK: 5,
      vector: queryVector,
      includeMetadata: true,
    });

    const context = searchResults.matches
      .map((match) => match.metadata.text)
      .join("\n\n---\n\n");

    // Step 4: Gemini for decision-making
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts:[{text:`
You are an insurance claim evaluator.

Context from the Easy Health Policy:
${context}

User Query:
${queries}

Task:
1. Identify key details from the query (age, procedure, location, policy duration).
2. Find relevant clauses from the above context (such as waiting periods or procedure coverage).
3. Decide whether the claim is Approved or Rejected.
4. Return a JSON object:
{
  "Decision": "Approved/Rejected",
  "Amount": <number or null>,
  "Justification": "Explain clearly, referencing the clause(s)."
}
`}],
        },
      ],
      config: {
        systemInstruction: `
You are an expert assistant for an insurance claim evaluation system.
Base your decision strictly on the provided context. 
If no relevant information is found, respond with:
"I could not find the answer in the provided document."
Be concise, factual, and avoid speculation.
        `,
      },
    });

    const answer =
      response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "No response";

    console.log("\n✅ Answer:");
    console.log(answer);
    
    return answer;
  } catch (error) {
    console.error("Error in chatting function:", error);
    throw error;
  }
}

// NEW FUNCTION: Process uploaded document and answer query
export async function processUploadedDocument(filePath, question) {
  try {
    console.log(`[${new Date().toISOString()}] Starting document processing from file: ${filePath}`);
    
    // Step 1: Validate file exists
    if (!filePath) {
      throw new Error('No file path provided');
    }

    // Step 2: Load document based on file extension
    console.log('Loading document from file...');
    let rawDocs;
    const fileExtension = path.extname(filePath).toLowerCase();
    
    try {
      switch (fileExtension) {
        case '.pdf':
          const pdfLoader = new PDFLoader(filePath);
          rawDocs = await pdfLoader.load();
          break;
        
        case '.txt':
          const textLoader = new TextLoader(filePath);
          rawDocs = await textLoader.load();
          break;
        
        case '.docx':
          const docxLoader = new DocxLoader(filePath);
          rawDocs = await docxLoader.load();
          break;
        
        case '.doc':
          // For .doc files, you might need additional libraries
          // For now, we'll throw an error suggesting conversion
          throw new Error('DOC files are not supported. Please convert to DOCX or PDF format.');
        
        default:
          throw new Error(`Unsupported file type: ${fileExtension}. Supported types: PDF, TXT, DOCX`);
      }
    } catch (loadError) {
      throw new Error(`Failed to load document: ${loadError.message}`);
    }

    if (!rawDocs || rawDocs.length === 0) {
      throw new Error('No content could be extracted from the uploaded file');
    }

    console.log(`Document loaded successfully. Pages/Sections: ${rawDocs.length}`);
    console.log(`Total content length: ${rawDocs.reduce((total, doc) => total + doc.pageContent.length, 0)} characters`);

    // Step 3: Split document into chunks
    console.log('Splitting document into chunks...');
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    const chunkedDocs = await textSplitter.splitDocuments(rawDocs);
    console.log(`Document split into ${chunkedDocs.length} chunks`);

    // Step 4: Create embeddings for chunks
    console.log('Creating embeddings...');
    const embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: process.env.GEMINI_API_KEY,
      model: "text-embedding-004",
    });

    // Step 5: Rewrite query
    const queries = await transformQuery(question);
    console.log(`Query rewritten: ${queries}`);

    // Step 6: Create query embedding
    const queryVector = await embeddings.embedQuery(queries);

    // Step 7: Create embeddings for all chunks and find most relevant ones
    console.log('Processing chunks and finding relevant content...');
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

    // Step 8: Calculate similarity scores and get top matches
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

    console.log(`Found ${topMatches.length} relevant chunks for the query`);
    console.log('Top similarities:', topMatches.map(m => m.similarity.toFixed(4)));

    const context = topMatches
      .map((match, index) => `[Chunk ${match.chunkIndex + 1}]: ${match.content}`)
      .join("\n\n---\n\n");

    // Step 9: Generate response using Gemini
    console.log('Generating response with Gemini...');
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [{
            text: `
You are an insurance claim evaluator.

Context from the uploaded document:
${context}

User Query:
${queries}

Task:
1. Identify key details from the query (age, procedure, location, policy duration).
2. Find relevant clauses from the above context (such as waiting periods or procedure coverage).
3. Decide whether the claim is Approved or Rejected.
4. Return a JSON object:
{
  "Decision": "Approved/Rejected",
  "Amount": <number or null>,
  "Justification": "Explain clearly, referencing the clause(s) and specific sections from the document."
}
`
          }],
        },
      ],
      config: {
        systemInstruction: `
You are an expert assistant for an insurance claim evaluation system.
Base your decision strictly on the provided context from the uploaded document. 
If no relevant information is found, respond with:
"I could not find the answer in the provided document."
Be concise, factual, and avoid speculation.
Always reference specific parts of the document in your justification.
        `,
      },
    });

    const answer =
      response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "No response";

    console.log("\n✅ Answer:");
    console.log(answer);
    
    return answer;
  } catch (error) {
    console.error("Error in processUploadedDocument function:", error);
    throw error;
  }
}

// Keep the URL processing function for backward compatibility
export async function processDocumentFromUrl(url, question) {
  try {
    console.log(`[${new Date().toISOString()}] Starting document processing from URL: ${url}`);
    
    // Step 1: Validate URL
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      throw new Error('Invalid URL provided. URL must start with http:// or https://');
    }

    // Step 2: Check if URL is accessible
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (!response.ok) {
        throw new Error(`URL is not accessible. Status: ${response.status}`);
      }
    } catch (fetchError) {
      throw new Error(`Failed to access URL: ${fetchError.message}`);
    }

    // Step 3: Load document from URL
    console.log('Loading document from URL...');
    let rawDocs;
    
    try {
      // Check if it's a PDF URL
      if (url.toLowerCase().includes('.pdf') || url.toLowerCase().includes('pdf')) {
        const pdfLoader = new WebPDFLoader(url);
        rawDocs = await pdfLoader.load();
      } else {
        // For non-PDF documents, we'll try to fetch the content directly
        const response = await fetch(url);
        const content = await response.text();
        rawDocs = [{
          pageContent: content,
          metadata: {
            source: url,
            loc: { pageNumber: 1 }
          }
        }];
      }
    } catch (loadError) {
      throw new Error(`Failed to load document: ${loadError.message}`);
    }

    if (!rawDocs || rawDocs.length === 0) {
      throw new Error('No content could be extracted from the provided URL');
    }

    console.log(`Document loaded successfully. Pages: ${rawDocs.length}`);

    // Step 4: Split document into chunks
    console.log('Splitting document into chunks...');
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    const chunkedDocs = await textSplitter.splitDocuments(rawDocs);
    console.log(`Document split into ${chunkedDocs.length} chunks`);

    // Step 5: Create embeddings for chunks
    console.log('Creating embeddings...');
    const embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: process.env.GEMINI_API_KEY,
      model: "text-embedding-004",
    });

    // Step 6: Rewrite query
    const queries = await transformQuery(question);
    console.log(`Query rewritten: ${queries}`);

    // Step 7: Create query embedding
    const queryVector = await embeddings.embedQuery(queries);

    // Step 8: Create embeddings for all chunks and find most relevant ones
    const chunkEmbeddings = await Promise.all(
      chunkedDocs.map(async (doc) => {
        const embedding = await embeddings.embedQuery(doc.pageContent);
        return {
          content: doc.pageContent,
          embedding: embedding,
          metadata: doc.metadata
        };
      })
    );

    // Step 9: Calculate similarity scores and get top matches
    const similarities = chunkEmbeddings.map(chunk => {
      const similarity = cosineSimilarity(queryVector, chunk.embedding);
      return {
        content: chunk.content,
        similarity: similarity,
        metadata: chunk.metadata
      };
    });

    // Sort by similarity and get top 5
    const topMatches = similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);

    const context = topMatches
      .map(match => match.content)
      .join("\n\n---\n\n");

    console.log(`Found ${topMatches.length} relevant chunks for the query`);

    // Step 10: Generate response using Gemini
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [{
            text: `
You are an insurance claim evaluator.

Context from the document:
${context}

User Query:
${queries}

Task:
1. Identify key details from the query (age, procedure, location, policy duration).
2. Find relevant clauses from the above context (such as waiting periods or procedure coverage).
3. Decide whether the claim is Approved or Rejected.
4. Return a JSON object:
{
  "Decision": "Approved/Rejected",
  "Amount": <number or null>,
  "Justification": "Explain clearly, referencing the clause(s)."
}
`
          }],
        },
      ],
      config: {
        systemInstruction: `
You are an expert assistant for an insurance claim evaluation system.
Base your decision strictly on the provided context from the document. 
If no relevant information is found, respond with:
"I could not find the answer in the provided document."
Be concise, factual, and avoid speculation.
        `,
      },
    });

    const answer =
      response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "No response";

    console.log("\n✅ Answer:");
    console.log(answer);
    
    return answer;
  } catch (error) {
    console.error("Error in processDocumentFromUrl function:", error);
    throw error;
  }
}

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