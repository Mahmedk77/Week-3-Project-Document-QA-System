import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { createClient } from "@supabase/supabase-js";



//* LLM Clients
export const groqModel = new ChatOpenAI({
  model: "openai/gpt-oss-20b",
  apiKey: process.env.GROQ_API_KEY,
  configuration: {
    baseURL: "https://api.groq.com/openai/v1",
  },
});

export const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-small",
  apiKey: process.env.OPENAI_API_KEY,
});
export const EMBEDDING_MODEL = 'text-embedding-3-small';

// Real OpenAI (not Groq) for /api/query generation — avoids Week 2's Groq
// TPM/TPD rate-limit issues while learning structured citation output.
export const queryModel = new ChatOpenAI({
  model: "gpt-4o-mini",
  apiKey: process.env.OPENAI_API_KEY,
});

//* SUPABASE Clients
export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

//For Docs in RAG
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);


