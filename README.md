# AI-Powered Insurance Claim Decision System

**Tech Stack:**  
Express.js · Node.js · LangChain · Google Generative AI API · Pinecone

Developed at **Bajaj HackRx 6.0**, this Retrieval-Augmented Generation (RAG) backend automates **insurance claim decisions** and answers policy-related queries with high accuracy.  
The system uses **Google Gemini** for query rewriting & decision-making, **GoogleGenerativeAIEmbeddings** for vector creation, and **Pinecone** for semantic clause retrieval.

---

## 🚀 Features

- **Query Understanding**  
  Accepts natural language or structured insurance-related questions.
  
- **LLM Query Rewriting**  
  Uses Gemini to convert shorthand queries into fully detailed, context-rich questions.

- **Vector Embeddings & Retrieval**  
  - Converts queries to vectors using `text-embedding-004` via GoogleGenerativeAIEmbeddings.
  - Fetches top-K relevant clauses from pre-embedded insurance policy documents in Pinecone.

- **Context Augmentation**  
  Retrieved clauses are stitched together with the user’s query to form a custom prompt.

- **Automated Decision Making**  
  Matches user details with policy clauses and outputs the answer with a proper justification.

---

## 📂 Flow of Control

1. **User Request**  
   - Question(s) and document link sent via POST request.
2. **LLM Orchestration**  
   - Query is rewritten for clarity and detail.
3. **Embedding Creation**  
   - Text converted into vector representation.
4. **Retrieval**  
   - Pinecone returns top matches from the policy document.
5. **Augmentation**  
   - Matches + query stitched into a prompt.
6. **Generation**  
   - Gemini produces the final answer or claim decision.
7. **Response**  
   - The response is sent back to the user.

---

## 🛠️ Installation & Setup

```bash
# Clone the repository
git clone https://github.com/sdass1918/bajajHackrx.git
cd bajajHackrx

# Install dependencies
npm install

# Create an .env file with the following variables
GEMINI_API_KEY=
PINECONE_API_KEY=
PINECONE_ENVIRONMENT=
PINECONE_INDEX_NAME=
OPENAI_API_KEY=

# Start the server
npm run dev
```

---

## This is how the curl request must be sent

```
curl -X POST https://bajajhackrx-0i4v.onrender.com/api/v1/hackrx/run \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer 45fcaee7dd6ff1411c28cc03b33d88c6354945fd787c5f239da3fadc5d9ec734" \
  -d '{
    "documents": "https://hackrx.blob.core.windows.net/assets/policy.pdf?sv=2023-01-03&st=2025-07-04T09%3A11%3A24Z&se=2027-07-05T09%3A11%3A00Z&sr=b&sp=r&sig=N4a9OU0w0QXO6AOIBiu4bpl7AXvEZogeT%2FjUHNO7HzQ%3D",
    "questions": [
      "What is the grace period for premium payment under the National Parivar Mediclaim Plus Policy?",
      "What is the waiting period for pre-existing diseases (PED) to be covered?",
      "Does this policy cover maternity expenses, and what are the conditions?",
      "What is the waiting period for cataract surgery?",
      "Are the medical expenses for an organ donor covered under this policy?",
      "What is the No Claim Discount (NCD) offered in this policy?",
      "Is there a benefit for preventive health check-ups?",
      "How does the policy define a 'Hospital'?",
      "What is the extent of coverage for AYUSH treatments?",
      "Are there any sub-limits on room rent and ICU charges for Plan A?"
    ]
  }'
```

## The response would look like

```
{"answers":["The specific information is not clearly stated in the provided document sections.",
"Expenses for pre-existing diseases and their direct complications are excluded until the expiry of thirty-six (36) months of continuous coverage after the date of inception of the first policy.",
"Yes, the policy covers maternity expenses, including childbirth and lawful medical termination of pregnancy, subject to a 24-month waiting period, limitations on the number of deliveries or terminations covered, and age restrictions for the insured female person.",
"Two years.","Yes, the policy covers the medical expenses for an organ donor's hospitalization during the policy period for harvesting an organ donated to an insured person, provided certain conditions are met, including compliance with the Transplantation of Human Organs Act, the organ is for an insured person who needs a transplant, the expenses are for inpatient care, and the claim is admitted under the In-patient Treatment Section for the insured person undergoing the transplant.","On renewal of policies with a term of one year, a flat 5% NCD is allowed on the base premium, provided no claims were reported in the expiring policy; for policies exceeding one year, the NCD amount for each claim-free year is aggregated, but shall not exceed a flat 5% of the total base premium for the policy term.","Yes, expenses of health check-ups shall be reimbursed at the end of a block of two continuous policy years, provided the policy has been continuously renewed without a break, subject to the limit stated in the Table of Benefits.","A hospital is defined as an institution for in-patient and day care for diseases or injuries, registered with local authorities or complying with specific criteria, including qualified nursing staff and medical practitioners, a fully equipped operation theatre, and a minimum number of inpatient beds.","The company will cover medical expenses for inpatient care under Ayurveda, Yoga and Naturopathy, Unani, Siddha and Homeopathy systems of medicines up to the limit of the Sum Insured as specified in the Policy Schedule in any AYUSH Hospital.","Yes, for Plan A, room charges are limited to 1% of the Sum Insured or the actual charges, whichever is lower, and ICU charges are limited to 2% of the Sum Insured or the actual charges, whichever is lower, per day per insured person."]}
```

## 📝 Notes

- The backend currently does not have a frontend interface.
- Designed for real-time insurance policy queries and claim decision-making.
- Documents should be accessible via a public link (PDF format preferred).

## General Flow
![Screenshot of the app](<rag_excalidraw (1).png>)

