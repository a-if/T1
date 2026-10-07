import { logger } from './logger.js';
import { uiText } from './font.js';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
export function progressText(job){const done=job.sent+job.failed+job.removed;return uiText(`📢 BROADCASTING...\n\n${done} / ${job.total}`)}
export function finishText(job){const seconds=Math.max(0,Math.round((Date.now()-job.startedAt)/1000));return uiText(`✅ BROADCAST FINISHED\n\n📬 TOTAL: ${job.total}\n✔️ SENT: ${job.sent}\n🚫 REMOVED: ${job.removed}\n⚠️ FAILED: ${job.failed}\n⏱ TIME: ${seconds}s`)}
export function errorText(job,error){return uiText(`❌ BROADCAST STOPPED\n\n✔️ SENT: ${job.sent}\n⚠️ FAILED: ${job.failed}\n
ERROR: ${error?.message||'Unknown error'}`)}
export const editStatus=(api,job,text)=>api.editMessageText(job.statusChatId,job.statusMessageId,text).catch(()=>{});
export async function broadcastStep(api,store,job,limit){
 const ids=store.audienceIds?await store.audienceIds(job.audience,job.afterId,limit):(job.channelUsers?await store.channelRequestIds(job.afterId,limit):await store.ids(job.kinds,job.afterId,limit));
 const next={...job};
 async function sendOne(id){for(let attempt=0;attempt<2;attempt++){try{const sent=job.mode==='forward'?await api.forwardMessage(id,job.fromChatId,job.messageId):await api.copyMessage(id,job.fromChatId,job.messageId);if(job.pin&&sent?.message_id)try{await api.pinMessage(id,sent.message_id)}catch(e){logger.debug(`Broadcast pin skipped: ${e.message}`)}next.sent++;return}catch(e){if(e.code===429&&attempt===0){await sleep(((e.retryAfter||1)+0.5)*1000);continue}if(e.code===403||(e.code===400&&/chat not found|user is deactivated/i.test(e.message))){try{await store.remove(id)}catch(_){}next.removed++}else next.failed++;return}}}
 await Promise.all(ids.map(sendOne));if(ids.length)next.afterId=ids[ids.length-1];return {job:next,done:ids.length<limit};
}
export async function runBroadcastLocal(api,store,startJob){let job=startJob,lastEdit=0;try{for(;;){const step=await broadcastStep(api,store,job,25);job=step.job;if(step.done)break;if(Date.now()-lastEdit>4000){lastEdit=Date.now();await editStatus(api,job,progressText(job))}await sleep(1000)}await editStatus(api,job,finishText(job))}catch(e){logger.error('Broadcast error:',e.message);await editStatus(api,job,errorText(job,e))}}
