import OpenAI from 'openai';
import { z } from 'zod';
import { HttpError } from '../security';
export class AIProviderError extends HttpError {
 constructor(public code:string,message:string,status=502,public retryable=false){super(status,message);this.name='AIProviderError';}
}
export const deepseekConfig=()=>({model:process.env.DEEPSEEK_MODEL?.trim()||'deepseek-flash',timeout:Math.min(90000,Math.max(1000,Number(process.env.DEEPSEEK_TIMEOUT_MS)||90000)),effort:z.enum(['none','low','high','max']).parse(process.env.DEEPSEEK_REASONING_EFFORT||'none')});
export function providerError(error:unknown):AIProviderError {
 if(error instanceof AIProviderError)return error;
 const e=error as {status?:number;name?:string};
 if(e?.status===401)return new AIProviderError('AI_AUTHENTICATION','DeepSeek rejected the API key. Update the DEEPSEEK_API_KEY Codespaces secret and restart the app and worker.');
 if(e?.status===402)return new AIProviderError('AI_BALANCE','DeepSeek balance is insufficient. Top up the provider account, then retry.',402);
 if(e?.status===429)return new AIProviderError('AI_RATE_LIMIT','DeepSeek rate limit reached. Wait briefly and retry.',429,true);
 if(e?.status===408||['APIConnectionTimeoutError','AbortError','TimeoutError'].includes(e?.name??''))return new AIProviderError('AI_TIMEOUT','DeepSeek timed out before completing the request. Retry; no successful result was recorded.',504,true);
 if(e?.status===400||e?.status===422)return new AIProviderError('AI_PARAMETERS','DeepSeek rejected the configured model or request parameters. Check DEEPSEEK_MODEL and the server configuration.');
 if(e?.status===403)return new AIProviderError('AI_FORBIDDEN','DeepSeek denied access to this model or account. Check provider permissions.');
 return new AIProviderError('AI_UNAVAILABLE','DeepSeek is unavailable or the connection was interrupted. No successful result was recorded.',503,true);
}
const usageSchema=z.object({input_tokens:z.number().int().nonnegative(),input_tokens_details:z.object({cached_tokens:z.number().int().nonnegative().optional()}).optional(),output_tokens:z.number().int().nonnegative(),total_tokens:z.number().int().nonnegative()});
export type Generation={provider:'deepseek';model:string;text:string;calls:{name:string;arguments:string}[];usage:z.infer<typeof usageSchema>|null;failure:AIProviderError|null};
export async function generateDeepSeek(input:{instructions:string;input:string;maxTokens:number;tools?:OpenAI.Responses.Tool[]}):Promise<Generation>{
 const key=process.env.DEEPSEEK_API_KEY;
 if(!key)throw new AIProviderError('AI_SETUP','DeepSeek is not configured. Set DEEPSEEK_API_KEY as a Codespaces secret and restart the app and worker.',503);
 const config=deepseekConfig();
 try{
  const client=new OpenAI({apiKey:key,baseURL:'https://api.deepseek.com',timeout:config.timeout,maxRetries:0});
  // DeepSeek always permits parallel function calls and does not enforce strict tool schemas.
  // Every argument is validated by the application; calls are never executed from partial deltas.
  const tools=input.tools?.map(t=>{if(t.type!=='function')throw new AIProviderError('AI_TOOL_UNSUPPORTED','Only function tools are enabled for DeepSeek.');const {strict,...supported}=t;return {...supported,strict:null};});
  const stream=await client.responses.create({model:config.model,instructions:input.instructions,input:input.input,max_output_tokens:input.maxTokens,reasoning:{effort:config.effort},stream:true,...(tools?{tools}: {})},{signal:AbortSignal.timeout(config.timeout)});
  let final:OpenAI.Responses.Response|undefined;
  for await(const event of stream){if(['response.completed','response.incomplete','response.failed'].includes(event.type)&&'response'in event)final=event.response as OpenAI.Responses.Response;}
  if(!final)throw new AIProviderError('AI_STREAM_INTERRUPTED','DeepSeek ended the stream without a completion receipt. Retry; no successful result was recorded.',502,true);
  const usage=usageSchema.safeParse(final.usage);
  const failure=final.status==='completed'?null:new AIProviderError(final.status==='incomplete'?'AI_INCOMPLETE':'AI_GENERATION_FAILED',final.status==='incomplete'?'DeepSeek reached an output limit or content boundary. Increase AI_MAX_OUTPUT_TOKENS or narrow the task; partial output was not applied.':'DeepSeek reported generation failure. No model action was applied.',502,final.status!=='incomplete');
  return {provider:'deepseek',model:final.model||config.model,text:final.output.filter(item=>item.type==='message').flatMap(item=>item.content.filter(c=>c.type==='output_text').map(c=>c.text)).join(''),calls:final.output.filter(item=>item.type==='function_call').map(c=>({name:c.name,arguments:c.arguments})),usage:usage.success?usage.data:null,failure:failure??(!usage.success?new AIProviderError('AI_USAGE_MISSING','DeepSeek omitted a valid usage receipt. The response was not accepted as successful.'):null)};
 }catch(error){throw providerError(error);}
}
