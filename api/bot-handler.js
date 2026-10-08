import { startMessage, donateMessage, DEFAULT_START_IMAGE } from './constants.js';
import { getRandomPositiveReaction, escapeHtml, splitEmojis } from './helper.js';
import { editStatus, progressText, errorText } from './broadcast.js';
import { logger } from './logger.js';
import { uiText, uiButton } from './font.js';
import TelegramBotAPI from './TelegramBotAPI.js';
import { randomBytes } from 'node:crypto';

const TARGETS={users:['users'],groups:['groups'],channels:['channels'],all:['users','groups','channels']};
const DEFAULT_WELCOME='👋 Welcome {mention} to <b>{group}</b>!\n\nPlease read the group rules and enjoy your stay. ❤️';
const DEFAULT_JOIN='👋 Hello {mention}!\n\nYour request to join <b>{group}</b> has been received.\nPlease wait while an admin reviews it. ✨';
const DEFAULT_JOIN_BUTTONS=[[
 {text:'Support',url:'https://t.me/TheComGC',style:'primary'},
 {text:'Update',url:'https://t.me/+cvKu67QTRW03Y2U1',style:'primary'}
]];
const DEFAULT_UPDATE_URL='https://t.me/+cvKu67QTRW03Y2U1';
const DEFAULT_SUPPORT_URL='https://t.me/TheComGC';
const MUTE_PERMISSIONS={can_send_messages:false,can_send_audios:false,can_send_documents:false,can_send_photos:false,can_send_videos:false,can_send_video_notes:false,can_send_voice_notes:false,can_send_polls:false,can_send_other_messages:false,can_add_web_page_previews:false,can_change_info:false,can_invite_users:false,can_pin_messages:false,can_manage_topics:false};
const UNMUTE_PERMISSIONS={can_send_messages:true,can_send_audios:true,can_send_documents:true,can_send_photos:true,can_send_videos:true,can_send_video_notes:true,can_send_voice_notes:true,can_send_polls:true,can_send_other_messages:true,can_add_web_page_previews:true,can_change_info:false,can_invite_users:false,can_pin_messages:false,can_manage_topics:true};
const COLORS=['primary','success','danger'];
function botLink(botUsername){return String(botUsername||'').replace(/^@/,'');}
async function safe(task){try{return await task()}catch(e){logger.warn('Storage error:',e.message)}}

let ME=null;
async function resolveUsername(api,given){if(given)return String(given).replace(/^@/,'');if(!ME){try{ME=await api.getMe()}catch(_){}}return ME?.username||''}

export async function onUpdate(data,api,Reactions,RestrictedChats,botUsername,RandomLevel,options={}){
 botUsername=await resolveUsername(api,botUsername);options={...options,botUsername};
 const {store=null,adminIds=[]}=options;
 if(data.chat_join_request){await handleJoinRequest(data.chat_join_request,api,store,options);return}
 if(data.chat_member){await handleChatMember(data.chat_member,api,store);return}
 if(data.callback_query){try{await onCallback(data.callback_query,api,options)}catch(e){logger.error(`Callback handler error: ${e?.message||e}`);try{await api.answerCallbackQuery(data.callback_query.id,'Something went wrong. Please try again.',true)}catch(_){} }return}
 if(data.my_chat_member){
  const {chat,new_chat_member,old_chat_member,from}=data.my_chat_member;
  if(store){
   if(['kicked','left'].includes(new_chat_member?.status)){
    await safe(()=>store.remove(chat.id));
   }else{
    await safe(()=>store.add(chat.id,chat.type,{force:true}));
    const wasActive=['member','administrator','creator'].includes(old_chat_member?.status);
    const isActive=['member','administrator','creator'].includes(new_chat_member?.status);
    const firstActivation=isActive&&!wasActive;
    const actorId=Number(from?.id||0);

    if(chat?.type==='channel' && isActive && actorId){
     await safe(()=>store.connect(actorId,chat.id,'channel',chat.title||'Channel'));
     const current=await store.getGroupSettings(chat.id);
     const patch={};
     if(current.reactions_enabled===undefined||current.reactions_enabled===null)patch.reactions_enabled=true;

     if(!chat?.username && ['administrator','creator'].includes(new_chat_member?.status)){

      const hasPriorSettings = typeof store.hasGroupSettings === 'function'
        ? await safe(()=>store.hasGroupSettings(chat.id))
        : false;
      if(!hasPriorSettings){
       patch.join_enabled=true;
       patch.join_mode='notify';
       patch.join_message=DEFAULT_JOIN;
       patch.join_buttons=DEFAULT_JOIN_BUTTONS;
      }else{
       if(!current.join_mode)patch.join_mode='notify';
       if(!current.join_message)patch.join_message=DEFAULT_JOIN;
       if(!Array.isArray(current.join_buttons)||current.join_buttons.length===0)patch.join_buttons=DEFAULT_JOIN_BUTTONS;
      }
     }
     if(Object.keys(patch).length)await safe(()=>store.updateGroupSettings(chat.id,patch));
     try{await api.sendMessage(actorId,uiText(`✅ <b>${escapeHtml(chat.title||'Channel')}</b> is connected.\n\nOpen the settings panel below to manage reactions and join requests.`),[[Object.assign(uiButton('⚙️ CHANNEL SETTINGS','primary'),{callback_data:`open:channel:${chat.id}`})]])}catch(e){logger.debug(`Channel DM skipped: ${e.message}`)}
    }

    if(['group','supergroup'].includes(chat?.type) && firstActivation && actorId){
     await safe(()=>store.connect(actorId,chat.id,'group',chat.title||'Group'));
     const current=await store.getGroupSettings(chat.id);
     if(current.reactions_enabled===undefined||current.reactions_enabled===null) await safe(()=>store.updateGroupSettings(chat.id,{reactions_enabled:true}));
     const updateUrl=options.updatesUrl||DEFAULT_UPDATE_URL;
          try{
      if(!options.isClone)await api.sendMessage(chat.id,uiText('📢 <b>Stay updated with the latest news and updates!</b>'),[[Object.assign(uiButton('📢 SUBSCRIBE MY CHANNEL','success'),{url:updateUrl})]]);
      await api.sendMessage(chat.id,uiText('In order to set me up, use <code>/groupsetting</code> or press the button below.'),[
       [Object.assign(uiButton('➕ ADD ME TO GROUP','success'),{url:`https://t.me/${botLink(botUsername)}?startgroup=botstart`}),Object.assign(uiButton('⚙️ GROUP SETTINGS','primary'),{url:`https://t.me/${botLink(botUsername)}?start=group_${chat.id}`})]
      ]);
     }catch(e){logger.warn(`Group setup message failed: ${e.message}`)}
    }
   }
  }
  return;
 }
 if(data.message||data.channel_post){
  const content=data.message||data.channel_post,chatId=content.chat.id,messageId=content.message_id,text=content.text||content.caption||'';
  if(store)await safe(()=>store.add(chatId,content.chat.type));
  if(store&&content.chat.type==='private'&&content.from?.id)await safe(()=>store.clearChannelRequestUser?.(content.from.id));
  const parts=text.trim().split(/\s+/),raw=parts[0]||'',arg=parts.slice(1).join(' '),command=raw.split('@')[0].toLowerCase();
  const isPrivate=content.chat.type==='private',isGroup=['group','supergroup'].includes(content.chat.type),isChannel=content.chat.type==='channel';
  const isGlobalAdmin=!!data.message&&isPrivate&&adminIds.includes(content.from?.id);
  const forwardedChannel=isPrivate?getForwardedChannel(content.reply_to_message||content):null;
  if(store&&content.from?.id&&isPrivate&&!command.startsWith('/')){const pending=await store.getPending(content.from.id);if(pending){await finishPending(api,content,pending,Reactions,store,botUsername,options);return}}
  if(data.message&&command==='/start')return sendStart(api,content,botUsername,options,arg);
  if(data.message&&command==='/help')return showHelp(api,content,botUsername,options);
  if(data.message&&(command==='/groupsetting'||(command==='/welcome'&&isGroup)))return handleGroupSettingCommand(api,content,store,options,forwardedChannel);
  if(data.message&&command==='/connectchannel'&&isPrivate)return connectChannelCommand(api,content,store,options,forwardedChannel,arg);
  if(data.message&&command==='/mychannels'&&isPrivate)return showConnections(api,chatId,content.from.id,store,options,'channel');
  if(data.message&&command==='/joinsetting'&&isPrivate)return openChannelFromForward(api,content,store,options,forwardedChannel);
  if(data.message&&command==='/reactions')return showReactionSettings(api,content,Reactions,store,options,forwardedChannel);
  if(data.message&&command==='/donate')return sendDonate(api,chatId,options);
  if(data.message&&isGroup&&(command==='/reactions_on'||command==='/reactions_off'))return setGroupReactionState(api,content,command==='/reactions_on',store);
  if(data.message&&isPrivate&&forwardedChannel&&(command==='/reactions_on'||command==='/reactions_off'))return setForwardedChannelState(api,content,forwardedChannel,command==='/reactions_on',store);
  if(isGlobalAdmin&&(command==='/stats'||command==='/users'))return sendStats(api,chatId,store);
  if(isGlobalAdmin&&command==='/broadcast')return askBroadcast(api,content,options,arg);
  if(isPrivate&&command==='/clone')return startClone(api,content,options);
  if(isPrivate&&command==='/myclones')return showClones(api,content,options);
  if(isGlobalAdmin&&isPrivate&&command==='/fsub_list')return fsubListCmd(api,content,options);
  if(isGlobalAdmin&&isPrivate&&command==='/fsub_add')return fsubAddCmd(api,content,options,arg);
  if(isGlobalAdmin&&isPrivate&&command==='/fsub_remove')return fsubRemoveCmd(api,content,options,arg);
  if(isGroup&&content.from?.id&&content.new_chat_members===undefined){
   if(store && !content.from.is_bot && !command.startsWith('/')){
    let blocked=false;try{blocked=await enforceRequiredChannels(api,content,store)}catch(e){logger.warn(`Required-channel check error: ${e.message}`)}
    if(blocked)return;
   }
   let custom=null,enabled=true;if(store){try{custom=await store.getReactions(chatId);enabled=await store.isReactionsEnabled(chatId)}catch(e){logger.warn(`Reaction settings read failed: ${e.message}`)}}
   const active=custom?.length?custom:Reactions;
   if(enabled&&active.length&&!RestrictedChats.includes(chatId)&&messageId&&Math.random()<=1-(RandomLevel/10))await safeReact(api,chatId,messageId,active);
  }else if(isChannel){

   let custom=null,enabled=true;
   if(store){try{custom=await store.getReactions(chatId);enabled=await store.isReactionsEnabled(chatId)}catch(e){logger.warn(`Channel reaction settings read failed: ${e.message}`)}}
   const active=custom?.length?custom:Reactions;
   if(enabled&&active.length&&!RestrictedChats.includes(chatId)&&messageId){
    const r=await safeReactChannel(api,chatId,messageId,active);
    if(!r.ok){
     if(r.reason==='disabled')logger.warn(`Channel ${chatId}: reactions are disabled in the channel settings (or the allowed set is empty). Enable reactions in the channel's info page.`);
     else if(r.reason==='no_match')logger.warn(`Channel ${chatId}: none of the configured emojis are in the channel's allowed reactions. Adjust EMOJI_LIST or the channel's reaction settings.`);
     else logger.warn(`Channel auto-reaction failed for ${chatId}/${messageId}: ${r.reason}. Usual causes: bot is not an admin in the channel, or it lacks admin rights.`);
    }
   }
  }
 }
 if(data.pre_checkout_query)await api.answerPreCheckoutQuery(data.pre_checkout_query.id,true);
}

const CHAT_CACHE=new Map();

function normEmoji(s){return String(s||'').replace(/\uFE0F/g,'');}
async function allowedReactionSet(api,chatId){
 const hit=CHAT_CACHE.get(chatId);
 if(hit&&Date.now()-hit.t<600000)return hit.v;
 let v=null;
 try{
  const chat=await api.getChat(chatId);
  const a=chat?.available_reactions;
  if(Array.isArray(a))v=new Set(a.map(r=>normEmoji(r?.emoji)).filter(Boolean));
 }catch(_){return null}
 CHAT_CACHE.set(chatId,{t:Date.now(),v});
 if(CHAT_CACHE.size>2000)CHAT_CACHE.delete(CHAT_CACHE.keys().next().value);
 return v;
}

async function safeReactChannel(api,chatId,messageId,active){
 const first=getRandomPositiveReaction(active);
 try{
  await api.setMessageReaction(chatId,messageId,first);
  return {ok:true};
 }catch(e){
  const firstErr=e?.message||String(e);

  if(!/reaction|react/i.test(firstErr))return {ok:false,reason:firstErr};

  try{
   const allowedSet=await allowedReactionSet(api,chatId);
   if(allowedSet&&allowedSet.size===0)return {ok:false,reason:'disabled'};
   const pool=(allowedSet?active.filter(c=>allowedSet.has(normEmoji(c))):active).filter(c=>c!==first);
   if(!pool.length)return {ok:false,reason:allowedSet?'no_match':firstErr};
   const retry=getRandomPositiveReaction(pool);
   await api.setMessageReaction(chatId,messageId,retry);
   return {ok:true};
  }catch(e2){return {ok:false,reason:e2?.message||String(e2)};}
 }
}

async function safeReact(api,chatId,messageId,active){
 const allowedSet=await allowedReactionSet(api,chatId);
 if(allowedSet&&allowedSet.size===0)return {ok:false,reason:'disabled'};
 let candidates=active;
 if(allowedSet)candidates=candidates.filter(e=>allowedSet.has(normEmoji(e)));
 if(!candidates.length)return {ok:false,reason:'no_match'};
 const emoji=getRandomPositiveReaction(candidates);
 try{
  await api.setMessageReaction(chatId,messageId,emoji,true);
  return {ok:true};
 }catch(e){
  const msg=e?.message||String(e);

  if(emoji!=='👍'&&/reaction/i.test(msg)){
   try{await api.setMessageReaction(chatId,messageId,'👍',true);return {ok:true};}
   catch(e2){return {ok:false,reason:e2?.message||String(e2)};}
  }
  return {ok:false,reason:msg};
 }
}

async function enforceRequiredChannels(api,content,store){
 const groupId=content.chat.id,userId=content.from.id;
 const s=await store.getGroupSettings(groupId),channels=getRequiredChannels(s);
 if(!s.required_enabled || !channels.length)return false;
 const missing=[];
 for(const ch of channels){
  try{
   const m=await api.getChatMember(ch.id,userId);
   const joined=['member','administrator','creator'].includes(m?.status)||(m?.status==='restricted'&&m?.is_member===true);
   if(!joined)missing.push(ch);
  }catch(e){logger.warn(`Required channel check failed (skipped): ${e.message}`)}
 }
 if(!missing.length)return false;
 if(await verifyAdmin(api,groupId,userId))return false;
 try{await api.restrictChatMember(groupId,userId,MUTE_PERMISSIONS)}catch(e){logger.warn(`Mute failed: ${e.message}`)}
 try{await api.deleteMessage(groupId,content.message_id)}catch(_){}
 const rows=missing.map(ch=>[Object.assign(uiButton(`📢 ${shortChannelName(ch)}`,'primary'),{url:ch.url||`https://t.me/${String(ch.id).replace(/^-100/,'')}`})]);
 rows.push(...(normalizeButtons(s.required_buttons)||[]));
 rows.push([Object.assign(uiButton('✅ CHECK & UNMUTE','success'),{callback_data:`reqcheck:${groupId}:${userId}`})]);
 try{await api.sendMessage(groupId,`${mention(content.from)} ${uiText('🔐 Please join all required channels before chatting in this group.\n\nJoin every channel above, then tap Check & Unmute.')}`,rows)}catch(e){logger.warn(`Required-channel notice failed: ${e.message}`)}
 return true;
}

async function handleChatMember(update,api,store){
 const chat=update.chat,member=update.new_chat_member,old=update.old_chat_member?.status,newStatus=member?.status;
 if(!store||!chat||!['group','supergroup'].includes(chat.type))return;
 await safe(()=>store.add(chat.id,chat.type));
 if(!['member','administrator'].includes(newStatus)||['member','administrator'].includes(old)||!member?.user||member.user.is_bot)return;
 const s=await store.getGroupSettings(chat.id);const channels=getRequiredChannels(s);if(s.required_enabled && channels.length){
  const missing=[];for(const ch of channels){let joined=false;try{const m=await api.getChatMember(ch.id,member.user.id);joined=['member','administrator','creator'].includes(m?.status)||(m?.status==='restricted'&&m?.is_member)}catch(e){joined=true;logger.warn(`Required channel check failed (skipped): ${e.message}`)}if(!joined)missing.push(ch)}
  if(missing.length){try{await api.restrictChatMember(chat.id,member.user.id,MUTE_PERMISSIONS)}catch(e){logger.warn(`Mute failed: ${e.message}`)}const rows=missing.map(ch=>[Object.assign(uiButton(`📢 ${shortChannelName(ch)}`,'primary'),{url:ch.url||`https://t.me/${String(ch.id).replace(/^-100/,'')}`})]);rows.push(...normalizeButtons(s.required_buttons)||[]);rows.push([Object.assign(uiButton('✅ CHECK & UNMUTE','success'),{callback_data:`reqcheck:${chat.id}:${member.user.id}`})]);try{await api.sendMessage(chat.id,`${mention(member.user)} ${uiText('🔐 Please join all required channels before chatting in this group.\n\nJoin every channel above, then tap Check & Unmute.')}`,rows)}catch(_){}return}
 }
 if(!s.welcome_enabled)return;const wt=renderTemplate(s.welcome_message||DEFAULT_WELCOME,member.user,chat),kb=normalizeButtons(s.welcome_buttons);try{if(s.welcome_mode==='only_user')await api.sendEphemeralMessage(chat.id,member.user.id,wt,kb);else await api.sendMessage(chat.id,wt,kb)}catch(e){if(s.welcome_mode==='only_user')try{await api.sendMessage(member.user.id,wt,kb)}catch(_) {}}
}

async function handleJoinRequest(request,api,store){if(!store)return;const chat=request.chat,user=request.from;if(!chat?.id||!user?.id)return;await safe(()=>store.addChannelRequestUser?.(user.id));await safe(()=>store.add(chat.id,chat.type));let s=await store.getGroupSettings(chat.id);s=await migrateDefaultJoinSettings(store,chat.id,s);if(!s.join_enabled)return;const recipient=request.user_chat_id||user.id,text=renderTemplate(s.join_message||DEFAULT_JOIN,user,chat),keyboard=normalizeButtons(s.join_buttons);try{await api.sendMessage(recipient,text,keyboard)}catch(e){logger.warn(`Join request notification failed: ${e.message}`)}if(s.join_mode==='auto_accept')try{await api.approveChatJoinRequest(chat.id,user.id);try{await api.sendMessage(recipient,renderTemplate('<b>✅ Your request has been accepted.</b>\nWelcome to {group}! 🎉',user,chat),keyboard)}catch(_){}}catch(e){logger.warn(`Auto-accept failed: ${e.message}`)}}
function renderTemplate(text,user,chat){const name=escapeHtml([user?.first_name,user?.last_name].filter(Boolean).join(' ')||'there'),username=user?.username?`@${escapeHtml(user.username)}`:name,mention=`<a href="tg://user?id=${user?.id}">${name}</a>`,group=escapeHtml(chat?.title||'this chat');return String(text).replaceAll('{name}',name).replaceAll('{username}',username).replaceAll('{mention}',mention).replaceAll('{group}',group)}
function mention(user){return `<a href="tg://user?id=${user.id}">${escapeHtml(user.first_name||'User')}</a>`}
function isDefaultJoinButtons(buttons){
 const flat=flattenButtons(buttons||[]).map(x=>x.b||x).filter(Boolean);
 if(flat.length!==2)return false;
 const a=flat[0],b=flat[1];
 return a.text==='Support'&&a.url===DEFAULT_SUPPORT_URL&&b.text==='Update'&&b.url===DEFAULT_UPDATE_URL;
}
async function migrateDefaultJoinSettings(store,chatId,s){
 if(!store||!s)return s;
 const patch={}; let changed=false;
 if(isDefaultJoinButtons(s.join_buttons)){
  const desired=DEFAULT_JOIN_BUTTONS.map(row=>row.map(x=>({...x})));
  const currentJson=JSON.stringify(s.join_buttons||[]),desiredJson=JSON.stringify(desired);
  if(currentJson!==desiredJson){patch.join_buttons=desired;changed=true;}
 }

 if(changed){await safe(()=>store.updateGroupSettings(chatId,patch));return {...s,...patch};}
 return s;
}
function normalizeButtons(buttons){if(!Array.isArray(buttons))return null;const rows=[];for(const item of buttons){if(Array.isArray(item)){const r=item.filter(x=>x?.text&&x?.url).slice(0,2).map(x=>({text:x.text,url:x.url,...(COLORS.includes(x.style)?{style:x.style}:{})}));if(r.length)rows.push(r)}else if(item?.text&&item?.url)rows.push([{text:item.text,url:item.url,...(COLORS.includes(item.style)?{style:item.style}:{})}]);}return rows.length?rows:null}
function getForwardedChannel(message){const o=message?.forward_origin;return o?.type==='channel'&&o.chat?.id?o.chat:null}

async function editPanel(api,chatId,messageId,text,inlineKeyboard=null){
 try{return await api.editMessageText(chatId,messageId,text,inlineKeyboard)}
 catch(textErr){
  if(/not modified/i.test(textErr?.message||''))return null;
  if(typeof api.editMessageCaption==='function'){
   try{return await api.editMessageCaption(chatId,messageId,text,inlineKeyboard)}catch(captionErr){
    if(/not modified/i.test(captionErr?.message||''))return null;
    logger.warn(`Panel edit failed for message ${messageId}: text=${textErr?.message||textErr}; caption=${captionErr?.message||captionErr}`);
   }
  }

  try{await api.deleteMessage(chatId,messageId)}catch(_){}
  return api.sendMessage(chatId,text,inlineKeyboard);
 }
}
async function verifyAdmin(api,chatId,userId){try{return ['creator','administrator'].includes((await api.getChatMember(chatId,userId))?.status)}catch{return false}}
async function verifyGroupAdmin(api,content){
 try {
  if(!content?.chat?.id||!content?.from?.id)return false;
  if(!['group','supergroup'].includes(content.chat.type))return false;
  return ['creator','administrator'].includes((await api.getChatMember(content.chat.id,content.from.id))?.status);
 } catch { return false; }
}
async function verifyBotAdmin(api,chatId){try{const me=await api.getMe();const m=await api.getChatMember(chatId,me.id);return ['creator','administrator'].includes(m?.status)}catch{return false}}
async function connectAndOpenChannel(api,content,store,options,channel){
 if(!channel?.id)return api.sendMessage(content.chat.id,uiText('⚠️ I could not identify that channel. Please forward a post from the channel again.'));
 const check=await verifyChannelSetup(api,channel.id);
 if(!check.ok)return api.sendMessage(content.chat.id,uiText(`⚠️ ${check.error}`));
 if(!(await verifyAdmin(api,channel.id,content.from.id)))return api.sendMessage(content.chat.id,uiText('⚠️ You must be a channel admin to connect this channel.'));
 await store.connect(content.from.id,channel.id,'channel',check.chat.title||channel.title||'Channel');
 return showChannelSettings(api,content.chat.id,content.from.id,channel.id,store,options);
}
async function connectChannelCommand(api,content,store,options,forwardedChannel,arg=''){
 if(!store)return notConfigured(api,content.chat.id);
 let channel=forwardedChannel||null;
 const raw=String(arg||'').trim();
 if(!channel && raw){
  let ref=raw;
  const m=ref.match(/^https?:\/\/t\.me\/(c\/)?([^/?#]+).*$/i);
  if(m) ref=m[1]?('-100'+m[2]):m[2];
  if(/^-?\d+$/.test(ref)) ref=Number(ref);
  else if(!ref.startsWith('@')) ref='@'+ref;
  try{channel=await api.getChat(ref)}catch(e){
   return api.sendMessage(content.chat.id,uiText('⚠️ I could not find that channel.\n\nFor a private channel, forward a post from the channel after adding me as an admin.'));
  }
 }
 if(!channel)return api.sendMessage(content.chat.id,uiText('📢 CONNECT CHANNEL\n\nSend the public channel @username or channel link.\nFor a private channel, forward one of its posts here after making me an admin.'));
 return connectAndOpenChannel(api,content,store,options,channel);
}

async function openChannelFromForward(api,content,store,options,forwardedChannel){
 if(!store)return notConfigured(api,content.chat.id);
 if(!forwardedChannel){
  const channels=await store.connections(content.from.id,'channel');
  if(channels.length===1)return showChannelSettings(api,content.chat.id,content.from.id,Number(channels[0].chat_id),store,options);
  if(channels.length>1)return showConnections(api,content.chat.id,content.from.id,store,options,'channel');
  return api.sendMessage(content.chat.id,uiText('📢 JOIN REQUEST SETTINGS\n\nForward a post from your channel here, or use /mychannels to select a connected channel.'));
 }
 return connectAndOpenChannel(api,content,store,options,forwardedChannel);
}

async function verifyChannelSetup(api,chatId){try{const c=await api.getChat(chatId);if(c?.type!=='channel')return {ok:false,error:'That chat is not a channel.'};if(!(await verifyBotAdmin(api,chatId)))return {ok:false,error:'Make me an admin in that channel first.'};return {ok:true,chat:c}}catch{return {ok:false,error:'I could not find/verify that channel. For a private channel, forward one of its posts to me after making me an admin.'}}}
async function notConfigured(api,id){return api.sendMessage(id,uiText('⚠️ Database is not configured.'))}

async function handleGroupSettingCommand(api,content,store,options,forwardedChannel){if(!store)return notConfigured(api,content.chat.id);if(['group','supergroup'].includes(content.chat.type)){if(!(await verifyGroupAdmin(api,content)))return api.sendEphemeralMessage(content.chat.id,content.from?.id,uiText('⚠️ Only group admins can use /groupsetting.'));await store.connect(content.from.id,content.chat.id,'group',content.chat.title||'Group');const url=`https://t.me/${botLink(options.botUsername)}?start=group_${content.chat.id}`;const text=uiText('⚙️ This group is connected. Open the private settings panel to manage everything easily.');try{return await api.sendEphemeralMessage(content.chat.id,content.from.id,text,[[Object.assign(uiButton('⚙️ OPEN GROUP SETTINGS','primary'),{url})]])}catch{return api.sendMessage(content.chat.id,text,[[Object.assign(uiButton('⚙️ OPEN GROUP SETTINGS','primary'),{url})]])}}if(content.chat.type==='private'){if(forwardedChannel)return connectAndOpenChannel(api,content,store,options,forwardedChannel);return showConnections(api,content.chat.id,content.from.id,store,options)}return api.sendMessage(content.chat.id,uiText('⚠️ Use /groupsetting in a group or in my private chat.'))}

async function showConnections(api,chatId,userId,store,options,onlyKind=null,editMessageId=null){
 const list=await store.connections(userId),groups=list.filter(x=>x.kind==='group'),channels=list.filter(x=>x.kind==='channel');
 const selected=onlyKind==='channel'?channels:onlyKind==='group'?groups:list;
 const rows=[];
 if(!onlyKind){
  rows.push([Object.assign(uiButton('👥 GROUPS','primary'),{callback_data:'pick:group'}),Object.assign(uiButton('📢 CHANNELS','primary'),{callback_data:'pick:channel'})]);
  rows.push([Object.assign(uiButton('➕ ADD ME TO GROUP','success'),{url:`https://t.me/${botLink(options.botUsername)}?startgroup=botstart`}),Object.assign(uiButton('➕ ADD ME TO CHANNEL','success'),{url:`https://t.me/${botLink(options.botUsername)}?startchannel=botstart`})]);
  rows.push([Object.assign(uiButton('↩️ BACK','primary'),{callback_data:'back'})]);
 }else{
  if(selected.length)rows.push(...selected.slice(0,30).map(x=>[Object.assign(uiButton(`${x.kind==='group'?'👥':'📢'} ${x.title||x.chat_id}`,'primary'),{callback_data:`open:${x.kind}:${x.chat_id}`})]));
  else rows.push([Object.assign(uiButton('ℹ️ NO CONNECTED TARGETS','primary'),{callback_data:'noop'})]);
  rows.push([Object.assign(uiButton('↩️ BACK','primary'),{callback_data:'connections'})]);
 }
 const text=uiText(`⚙️ CONNECTED TARGETS\n\n👥 Groups: ${groups.length}\n📢 Channels: ${channels.length}`);
 if(editMessageId)return editPanel(api,chatId,editMessageId,text,rows);
 return api.sendMessage(chatId,text,rows);
}
async function showGroupSettings(api,chatId,userId,targetId,store,options,editMessageId=null){const s=await store.getGroupSettings(targetId),required=getRequiredChannels(s);const text=uiText(`⚙️ GROUP SETTINGS\n\n👋 Welcome: ${s.welcome_enabled?'🟢 ON':'🔴 OFF'}\n❤️ Reactions: ${s.reactions_enabled?'🟢 ON':'🔴 OFF'}\n🔐 Required Channels: ${required.length}`);const kb=[[Object.assign(uiButton(s.welcome_enabled?'👋 WELCOME ON':'👋 WELCOME OFF',s.welcome_enabled?'success':'danger'),{callback_data:`gs:welcome:${targetId}:${s.welcome_enabled?0:1}`}),Object.assign(uiButton('📝 MESSAGE','primary'),{callback_data:`input:wmsg:${targetId}`})],[Object.assign(uiButton(`${s.welcome_mode==='only_user'?'✅ ':''}👤 ONLY USER`,s.welcome_mode==='only_user'?'success':'primary'),{callback_data:`gs:wmode:${targetId}:only_user`}),Object.assign(uiButton(`${s.welcome_mode==='group'?'✅ ':''}👥 GROUP`,s.welcome_mode==='group'?'success':'primary'),{callback_data:`gs:wmode:${targetId}:group`})],[Object.assign(uiButton('🔘 BUTTONS','primary'),{callback_data:`buttons:welcome:${targetId}`})],[Object.assign(uiButton(s.reactions_enabled?'❤️ REACTIONS ON':'❤️ REACTIONS OFF',s.reactions_enabled?'success':'danger'),{callback_data:`gs:react:${targetId}:${s.reactions_enabled?0:1}`}),Object.assign(uiButton('✏️ REACTIONS','primary'),{callback_data:`input:reactions:${targetId}`})],[Object.assign(uiButton(s.required_enabled?'🔐 REQUIRED CHANNELS 🟢':'🔐 REQUIRED CHANNELS 🔴','primary'),{callback_data:`reqset:${targetId}`})],[Object.assign(uiButton('👁 PREVIEW','success'),{callback_data:`preview:welcome:${targetId}`}),Object.assign(uiButton('🔌 DISCONNECT','danger'),{callback_data:`disconnect:group:${targetId}`})],[Object.assign(uiButton('↩️ CONNECTIONS','primary'),{callback_data:'connections'})]];return editMessageId?editPanel(api,chatId,editMessageId,text,kb):api.sendMessage(chatId,text,kb)}
async function showChannelSettings(api,chatId,userId,targetId,store,options,editMessageId=null){let s=await store.getGroupSettings(targetId);
 s=await migrateDefaultJoinSettings(store,targetId,s);const text=uiText(`📢 CHANNEL SETTINGS\n\n❤️ Reactions: ${s.reactions_enabled?'🟢 ON':'🔴 OFF'}\n🛡️ Join Requests: ${s.join_enabled?'🟢 ON':'🔴 OFF'}\nMode: ${s.join_mode==='auto_accept'?'✅ AUTO ACCEPT':'🔔 NOTIFY ONLY'}`);const kb=[[Object.assign(uiButton(s.reactions_enabled?'❤️ REACTIONS ON':'❤️ REACTIONS OFF',s.reactions_enabled?'success':'danger'),{callback_data:`cs:react:${targetId}:${s.reactions_enabled?0:1}`})],[Object.assign(uiButton('✏️ CUSTOM REACTIONS','primary'),{callback_data:`input:reactions:${targetId}:channel`})],[Object.assign(uiButton(s.join_enabled?'🛡️ REQUESTS ON':'🛡️ REQUESTS OFF',s.join_enabled?'success':'danger'),{callback_data:`cs:join:${targetId}:${s.join_enabled?0:1}`}),Object.assign(uiButton(s.join_mode==='auto_accept'?'🔔 NOTIFY ONLY':'✅ AUTO ACCEPT','primary'),{callback_data:`cs:mode:${targetId}:${s.join_mode==='auto_accept'?'notify':'auto_accept'}`})],[Object.assign(uiButton('📝 REQUEST MESSAGE','primary'),{callback_data:`input:jmsg:${targetId}`})],[Object.assign(uiButton('🔘 REQUEST BUTTONS','primary'),{callback_data:`requestbuttons:${targetId}`})],[Object.assign(uiButton('👁 PREVIEW','success'),{callback_data:`preview:join:${targetId}`}),Object.assign(uiButton('🔌 DISCONNECT','danger'),{callback_data:`disconnect:channel:${targetId}`})],[Object.assign(uiButton('↩️ CONNECTIONS','primary'),{callback_data:'connections'})]];return editMessageId?editPanel(api,chatId,editMessageId,text,kb):api.sendMessage(chatId,text,kb)}

async function beginInput(api,q,store,mode,targetId,prompt,payload={}){await store.setPending(q.from.id,targetId,mode,{...payload,panel_chat_id:q.message.chat.id,panel_message_id:q.message.message_id});await api.answerCallbackQuery(q.id);return editPanel(api,q.message.chat.id,q.message.message_id,uiText(prompt),[[Object.assign(uiButton('❌ CANCEL','danger'),{callback_data:'inputcancel'})]])}
function buttonKey(target){return target==='join'?'join_buttons':target==='required'?'required_buttons':'welcome_buttons'}
function buttonKind(target){return target==='join'?'channel':target==='required'?'group':'group'}
function flattenButtons(rows){return (rows||[]).flatMap((row,ri)=>row.map((b,ci)=>({b,ri,ci})))}
function rebuildRows(items,rowMode=2){const rows=[];for(let i=0;i<items.length;i+=rowMode)rows.push(items.slice(i,i+rowMode));return rows}

async function finishPending(api,content,pending,Reactions,store,botUsername,options){const value=(content.text||'').trim(),p=pending.payload||{};if(!value)return api.sendMessage(content.chat.id,uiText('⚠️ Input cannot be empty. Please try again.'));
 if(pending.mode==='reqchannel')return addRequiredChannel(api,content,pending.chatId,value,store,options,pending.payload);
 if(pending.mode==='clone_token')return cloneTokenStep(api,content,value,store,options,pending);
 if(pending.mode==='clone_owner')return cloneOwnerStep(api,content,value,store,options,pending);
 await store.clearPending(content.from.id);
 if(pending.mode==='wmsg'||pending.mode==='jmsg'){await store.updateGroupSettings(pending.chatId,{[pending.mode==='wmsg'?'welcome_message':'join_message']:value});return pendingPanel(api,pending,p,pending.chatId,pending.mode==='wmsg'?'group':'channel',store,options)}
 if(pending.mode==='reactions'){const r=splitEmojis(value).slice(0,20);if(!r.length)return api.sendMessage(content.chat.id,uiText('⚠️ No valid emoji reactions found. Send emoji only, for example: 👍 ❤️ 🔥'));await store.setReactions(pending.chatId,r);return pendingPanel(api,pending,p,pending.chatId,p.channel?'channel':buttonKind('welcome'),store,options)}
 if(pending.mode==='button_name'){const draft={target:p.target,name:value};await store.setPending(content.from.id,pending.chatId,'button_link',{...draft,panel_chat_id:p.panel_chat_id,panel_message_id:p.panel_message_id});return editPanel(api,p.panel_chat_id,p.panel_message_id,uiText('🔗 NOW SEND THE BUTTON LINK.\n\nEXAMPLE: https://example.com'),[[Object.assign(uiButton('❌ CANCEL','danger'),{callback_data:'inputcancel'})]])}
 if(pending.mode==='button_link'){if(!/^https?:\/\//i.test(value))return api.sendMessage(content.chat.id,uiText('⚠️ Please send a valid http:// or https:// link.'));await store.setPending(content.from.id,pending.chatId,'button_color',{...p,link:value,panel_chat_id:p.panel_chat_id,panel_message_id:p.panel_message_id});return editPanel(api,p.panel_chat_id,p.panel_message_id,uiText('🎨 CHOOSE THE BUTTON COLOR.'),[[Object.assign(uiButton('🔵 PRIMARY','primary'),{callback_data:'inputcolor:primary'}),Object.assign(uiButton('🟢 SUCCESS','success'),{callback_data:'inputcolor:success'})],[Object.assign(uiButton('🔴 DANGER','danger'),{callback_data:'inputcolor:danger'})],[Object.assign(uiButton('❌ CANCEL','danger'),{callback_data:'inputcancel'})]])}
 if(pending.mode==='button_edit_name'){const key=buttonKey(p.target),s=await store.getGroupSettings(pending.chatId),rows=s[key]||[];if(rows[p.ri]?.[p.ci])rows[p.ri][p.ci].text=value;await store.updateGroupSettings(pending.chatId,{[key]:rows});return buttonManager(api,content.chat.id,p.panel_message_id,pending.chatId,p.target,store)}
 if(pending.mode==='button_edit_link'){if(!/^https?:\/\//i.test(value))return api.sendMessage(content.chat.id,uiText('⚠️ Please send a valid http:// or https:// link.'));const key=buttonKey(p.target),s=await store.getGroupSettings(pending.chatId),rows=s[key]||[];if(rows[p.ri]?.[p.ci])rows[p.ri][p.ri===p.ri?p.ci:p.ci].url=value;await store.updateGroupSettings(pending.chatId,{[key]:rows});return buttonManager(api,content.chat.id,p.panel_message_id,pending.chatId,p.target,store)}
 if(pending.mode==='button_row'){const row=Math.max(1,Math.min(2,Number(value)||1)),key=buttonKey(p.target),s=await store.getGroupSettings(pending.chatId),flat=flattenButtons(s[key]||[]).map(x=>x.b);await store.updateGroupSettings(pending.chatId,{[key]:rebuildRows(flat,row)});return buttonManager(api,content.chat.id,p.panel_message_id,pending.chatId,p.target,store)}
 return pendingPanel(api,pending,p,pending.chatId,p.channel?'channel':'group',store,options)
}
async function addRequiredChannel(api,content,groupId,value,store,options,payload){
 let id=value.trim(),url='';
 if(value.includes('|')){const parts=value.split('|').map(x=>x.trim());id=parts[0];url=parts[1]||''}
 let chatId=/^-?\d+$/.test(id)?Number(id):id;
 if(/^https?:\/\/t\.me\//i.test(id)){const m=id.match(/t\.me\/([A-Za-z0-9_]+)/i);if(m)chatId='@'+m[1]}
 const fail=async(message)=>{
  const kb=[[Object.assign(uiButton('🔄 TRY AGAIN','success'),{callback_data:`reqretry:${groupId}`}),Object.assign(uiButton('❌ CANCEL','danger'),{callback_data:`reqcancel:${groupId}`})]];
  if(payload?.panel_chat_id&&payload?.panel_message_id){try{return await editPanel(api,payload.panel_chat_id,payload.panel_message_id,uiText(`⚠️ ${message}\n\nPlease try again.`),kb)}catch(_){} }
  return api.sendMessage(content.chat.id,uiText(`⚠️ ${message}\n\nPlease try again.`),kb);
 };
 if(!(await verifyBotAdmin(api,groupId)))return fail('Make me an admin in that group first.');
 const check=await verifyChannelSetup(api,chatId);
 if(!check.ok)return fail(check.error);
 const c=check.chat;
 if(!(await verifyAdmin(api,c.id,content.from.id)))return fail('You are not an admin of this channel.');
 if(!url&&!c.username)return fail('This is a private channel. Send the channel ID together with its invite/join-request link.');
 const s=await store.getGroupSettings(groupId),chs=getRequiredChannels(s);
 if(chs.some(x=>Number(x.id)===Number(c.id)))return fail('This channel is already in the required-channel list.');
 const finalUrl=url||(c.username?`https://t.me/${c.username}`:'');
 chs.push({id:Number(c.id),url:finalUrl,title:c.title||'Required Channel'});
 await store.updateGroupSettings(groupId,{required_channels:chs,required_channel_id:Number(c.id),required_channel_url:finalUrl,required_enabled:true});
 await store.clearPending(content.from.id);
 return showRequiredChannels(api,payload.panel_chat_id,payload.panel_message_id,groupId,store);
}

async function pendingPanel(api,pending,p,targetId,kind,store,options){const panelId=p.panel_message_id,chatId=p.panel_chat_id;if(!panelId)return kind==='group'?showGroupSettings(api,chatId||pending.chatId,pending.chatId,targetId,store,options):showChannelSettings(api,chatId||pending.chatId,pending.chatId,targetId,store,options);return kind==='group'?showGroupSettings(api,chatId,pending.chatId,targetId,store,options,panelId):showChannelSettings(api,chatId,pending.chatId,targetId,store,options,panelId)}

function cloneStartText(name){
 const safeName=escapeHtml(name||'UserName');
 return startMessage.replace('UserName',safeName).replace(/\n\n<blockquote><b>ᴍᴀɪɴᴛᴀɪɴᴇᴅ ʙʏ :<\/b>.*?<\/blockquote>/s,'');
}
function startView(firstName,botUsername,options){
 const name=escapeHtml(firstName||'UserName'),updates=options.updatesUrl||DEFAULT_UPDATE_URL,support=options.supportUrl||DEFAULT_SUPPORT_URL;
 if(options.isClone){
  const cleanText=cloneStartText(firstName);
  const mainBot=botLink(options.mainBotUsername||'');
  const ckb=[
   [Object.assign(uiButton('⇆ ADD ME TO YOUR CHANNELS ⇆','success'),{url:`https://t.me/${botLink(botUsername)}?startchannel=botstart`})],
   [Object.assign(uiButton('• SUPPORT •','primary'),{url:'https://t.me/TheComGC'}),Object.assign(uiButton('• UPDATES •','primary'),{url:'https://t.me/PythonBotz'})],
  ];
  if(mainBot)ckb.push([Object.assign(uiButton('🤖 CLONE BOT','primary'),{url:`https://t.me/${mainBot}?start=clone`}),Object.assign(uiButton('❓ HELP','primary'),{callback_data:'help'})]);
  ckb.push([Object.assign(uiButton('⇆ ADD ME TO YOUR GROUPS ⇆','success'),{url:`https://t.me/${botLink(botUsername)}?startgroup=botstart`})]);
  return {text:cleanText,kb:ckb};
 }
 const text=startMessage.replace('UserName',name);
 const kb=[[Object.assign(uiButton('⇆ ADD ME TO YOUR CHANNELS ⇆','success'),{url:`https://t.me/${botLink(botUsername)}?startchannel=botstart`})],[Object.assign(uiButton('⇆ ADD ME TO YOUR GROUPS ⇆','success'),{url:`https://t.me/${botLink(botUsername)}?startgroup=botstart`})],[Object.assign(uiButton('❓ HELP','primary'),{callback_data:'help'}),Object.assign(uiButton('⚙️ GROUP SETTINGS','primary'),{callback_data:'settings'})],[Object.assign(uiButton('• UPDATES •','primary'),{url:updates}),Object.assign(uiButton('• SUPPORT •','primary'),{url:support})],[Object.assign(uiButton('🤖 CLONE','success'),{callback_data:'clone'})]];
 return {text,kb};
}
function helpView(options){
 if(options.isClone){
  const text=uiText(`❖ HELP CENTER\n\n🤖 WHAT I DO\n• Auto Reaction: automatically reacts to messages in groups and channels.\n\n👤 COMMANDS\n/start — open the main menu.\n/groupsetting — connect and manage a group.\n/connectchannel — connect a channel.\n/reactions — reaction settings.`);
  return {text,kb:[[Object.assign(uiButton('◀️ BACK','primary'),{callback_data:'back'})]]};
 }
 const text=uiText(`❖ HELP CENTER\n\n🤖 WHAT I DO\n• Auto Reaction: automatically reacts to eligible group and channel messages.\n• Group Settings: manage each connected group from one private dashboard.\n• Channel Settings: connect channels, customize reactions and manage join requests.\n\n⚙️ GROUP FEATURES\n• Welcome: turn it on/off, choose Group or Only User mode, edit message and buttons.\n• Required Channels: add multiple channels; new members must join all before chatting.\n• Reactions: turn auto reactions on/off and choose custom emojis.\n\n📢 CHANNEL FEATURES\n• /connectchannel: connect a public channel or a verified private channel.\n• /mychannels: open your connected channels.\n• Reactions: customize the emojis used by the bot.\n• Join Requests: Notify Only or Auto Accept, with custom message and buttons.\n\n👤 USER COMMANDS\n/start — open the main menu.\n/help — show this help.\n/reactions — open reaction settings for a connected chat/channel.\n/donate — support the bot.\n\n👥 GROUP ADMIN COMMANDS\n/groupsetting — connect and manage the group.\n/welcome — open group settings quickly.\n/reactions_on — enable reactions.\n/reactions_off — disable reactions.\n\n📢 CHANNEL ADMIN COMMANDS\n/connectchannel — connect a channel.\n/mychannels — list connected channels.\n/joinsetting — open channel join-request settings.\n\n📣 BROADCAST\nBot admins can broadcast a replied message to Users, Groups, Channels, or All. Users includes channel-request users.\\n\\n🤖 CLONES\\n/clone — create a white-label clone from a BotFather token.\\n/myclones — list cloned bots and revoke them.`);
 const kb=[[Object.assign(uiButton('💬 SUPPORT','primary'),{url:options.supportUrl||DEFAULT_SUPPORT_URL})],[Object.assign(uiButton('◀️ BACK','primary'),{callback_data:'back'})]];
 return {text,kb};
}
async function sendStart(api,content,botUsername,options,arg=''){if(arg==='clone')return startClone(api,content,options);
if(arg.startsWith('group_')){const id=Number(arg.slice(6));if(id&&await verifyAdmin(api,id,content.from.id)&&options.store){const chat=await api.getChat(id).catch(()=>({}));await options.store.connect(content.from.id,id,'group',chat.title||`Group ${id}`);return showGroupSettings(api,content.chat.id,content.from.id,id,options.store,options)}return api.sendMessage(content.chat.id,uiText('⚠️ Only the admins/owner of that group can open its settings. Make sure you are an admin there and that I am added to the group.'))}
if(arg.startsWith('channel_')){const id=Number(arg.slice(8));if(id&&await verifyAdmin(api,id,content.from.id)&&options.store){const chat=await api.getChat(id).catch(()=>({}));await options.store.connect(content.from.id,id,'channel',chat.title||`Channel ${id}`);return showChannelSettings(api,content.chat.id,content.from.id,id,options.store,options)}return api.sendMessage(content.chat.id,uiText('⚠️ Only admins of that channel can open its settings.'))}
const v=startView(content.from?.first_name,botUsername,options),media=options.startAnimation||DEFAULT_START_IMAGE;
 if(media){
  const isAnimation=/\.(mp4|gif|webm|mov)(\?|#|$)/i.test(media);
  if(isAnimation){try{return await api.sendAnimation(content.chat.id,media,v.text,v.kb)}catch(_){}}
  try{return await api.sendPhoto(content.chat.id,media,v.text,v.kb)}catch(e){logger.debug(`Start media failed: ${e?.message||e}`)}
 }
 return api.sendMessage(content.chat.id,v.text,v.kb)}
async function showHelp(api,content,botUsername,options){const v=helpView(options);return api.sendMessage(content.chat.id,v.text,v.kb)}
async function sendDonate(api,id,options){if(options.isClone)return api.sendMessage(id,uiText('💰 Donations are not enabled on this bot.'));if(options.donateAnimation)try{await api.sendAnimation(id,options.donateAnimation,uiText('🙏 Support Auto Reaction Bot ✨'))}catch(_){}return api.sendInvoice(id,uiText('Donate to Auto Reactions Bot ✨'),uiText(donateMessage),'{}','', 'donate','XTR',[{label:'Pay ⭐️5',amount:5}])}
async function sendStats(api,id,store){const c=await store.counts(),r=store.channelRequestCount?await store.channelRequestCount():0;return api.sendMessage(id,uiText(`📊 BOT STATS\n\n👤 Users: ${c.users}\n👥 Groups: ${c.groups}\n📢 Channels: ${c.channels}\n📨 Channel Request Users: ${r}\n\n🧮 Total Chats: ${c.users+c.groups+c.channels}`))}

async function askBroadcast(api,content,options,arg=''){
 const {store,enqueueBroadcast}=options;
 if(!store||!enqueueBroadcast)return notConfigured(api,content.chat.id);
 const reply=content.reply_to_message;
 if(!reply){
  const text=uiText('📢 BROADCAST HELP\n\n<blockquote><b>⚠️ PLEASE REPLY TO ANY MESSAGE TO START A BROADCAST.</b></blockquote>\n\nUSAGE:\n/broadcast — Users\n/broadcast group — Connected Groups\n/broadcast channel — Connected Channels\n/broadcast all — Users + Groups + Channels\n\nAfter choosing the audience, choose Copy or Forward, then Pin or Without Pin.');
  return api.sendMessage(content.chat.id,text,[[Object.assign(uiButton('❌ CLOSE','danger'),{callback_data:'bcx'})]]);
 }
 const audience=(arg||'users').trim().toLowerCase();
 if(!['users','group','channel','all'].includes(audience)){
  return api.sendMessage(content.chat.id,uiText('⚠️ INVALID BROADCAST TARGET\n\nUse one of:\n/broadcast\n/broadcast group\n/broadcast channel\n/broadcast all'));
 }
 const normalized=audience==='group'?'groups':audience==='channel'?'channels':audience;
 const count=store.audienceCount?Number(await store.audienceCount(normalized)):0;
 const base=`${content.chat.id}:${reply.message_id}:${normalized}`;
 return api.sendMessage(content.chat.id,uiText(`📢 BROADCAST\n\n🎯 ${normalized.toUpperCase()}\n👥 RECIPIENTS: ${count}\n\nChoose how to deliver the replied message.`),[
  [Object.assign(uiButton('📋 COPY','primary'),{callback_data:`bc:${base}:copy`}),Object.assign(uiButton('↪️ FORWARD','primary'),{callback_data:`bc:${base}:forward`})],
  [Object.assign(uiButton('❌ CANCEL','danger'),{callback_data:'bcx'})]
 ]);
}

function cloneFeatureOn(store){return !!store&&typeof store.addClone==='function';}
const CLONE_CANCEL_KB=[[Object.assign(uiButton('❌ CANCEL','danger'),{callback_data:'clcancel'})]];

async function animatePrompt(api,chatId,msgId,frames,delayMs=450){
 if(!msgId)return;
 for(const f of frames){try{await api.editMessageText(chatId,msgId,uiText(f))}catch(_){}await new Promise(r=>setTimeout(r,delayMs));}
}
async function setPrompt(api,chatId,msgId,text,kb){
 if(!msgId)return api.sendMessage(chatId,uiText(text),kb);
 try{return await api.editMessageText(chatId,msgId,uiText(text),kb||[])}
 catch(_){return api.sendMessage(chatId,uiText(text),kb)}
}
function clonePromptOf(pending){const p=pending?.payload||{};return {chatId:p.prompt_chat_id,msgId:p.prompt_message_id};}
async function startClone(api,content,options){
 const {store}=options;
 if(options.isClone){
  const mainBot=botLink(options.mainBotUsername||'');
  const rows=mainBot?[[Object.assign(uiButton('🤖 CLONE YOUR OWN BOT','primary'),{url:`https://t.me/${mainBot}?start=clone`})]]:[];
  return api.sendMessage(content.chat.id,uiText('🤖 Clones are created on the main bot. Tap below to start:'),rows);
 }
 if(!cloneFeatureOn(store))return api.sendMessage(content.chat.id,uiText('⚠️ Clone feature needs MongoDB on the main bot.'));
 if(!options.publicOrigin)return api.sendMessage(content.chat.id,uiText('⚠️ WEBHOOK_URL is not configured on the main bot.'));
 const missing=await fsubMissing(api,content.from.id,options);
 if(missing.length)return sendFsubPrompt(api,content.chat.id,missing);
 return beginCloneFlow(api,content,options);
}
function parseFsubIds(v){return String(v||'').split(',').map(x=>Number(x.trim())).filter(n=>Number.isFinite(n)&&n!==0);}
async function getFsubChannels(store){
 const ids=new Set(parseFsubIds(process.env.FSUB_CHANNELS));
 if(store&&typeof store.fsubList==='function'){
  try{const {added=[],removed=[]}=await store.fsubList();added.forEach(id=>ids.add(Number(id)));removed.forEach(id=>ids.delete(Number(id)));}catch(_){}
 }
 return [...ids];
}
async function fsubChannelInfo(api,channelId){
 let title=`Channel ${channelId}`,url=null;
 try{
  const chat=await api.getChat(channelId);
  if(chat?.title)title=chat.title;
  if(chat?.username)url=`https://t.me/${chat.username}`;
  else{
   try{url=await api.exportInviteLink(channelId)}catch(_){}
   if(!url){try{url=await api.createChatInviteLink(channelId)}catch(_){}}
  }
 }catch(_){}
 return {id:channelId,title,url};
}
async function fsubMissing(api,userId,options){
 const channels=await getFsubChannels(options.store);
 if(!channels.length)return [];
 const missing=[];
 for(const cid of channels){
  let member=false;
  try{
   const m=await api.getChatMember(cid,userId);
   member=['creator','administrator','member'].includes(m?.status)||(m?.status==='restricted'&&!!m?.is_member);
  }catch(_){}
  if(!member)missing.push(await fsubChannelInfo(api,cid));
 }
 return missing;
}
async function sendFsubPrompt(api,chatId,missing){
 const rows=missing.map(ch=>ch.url?[Object.assign(uiButton(`📢 ${ch.title}`,'primary'),{url:ch.url})]:[Object.assign(uiButton(`📢 ${ch.title}`,'primary'),{callback_data:'noop'})]);
 rows.push([Object.assign(uiButton('✅ CHECK','success'),{callback_data:'fsubcheck'})]);
 const linkLines=missing.filter(ch=>ch.url).map(ch=>`• <a href="${ch.url}">${escapeHtml(ch.title)}</a>`);
 const text=uiText('⚠️ JOIN REQUIRED\n\nTo create a bot clone, join our channels first, then tap CHECK.')+(linkLines.length?'\n\n'+linkLines.join('\n'):'');
 return api.sendMessage(chatId,text,rows);
}
async function fsubListCmd(api,content,options){
 const ids=await getFsubChannels(options.store);
 if(!ids.length)return api.sendMessage(content.chat.id,uiText('📋 No force-subscribe channels set.\n\nUse /fsub_add <channel_id> or set FSUB_CHANNELS env.'));
 const infos=await Promise.all(ids.map(id=>fsubChannelInfo(api,id)));
 const lines=infos.map(c=>`• ${escapeHtml(c.title)} — <code>${c.id}</code>${c.url?` — <a href="${c.url}">link</a>`:''}`);
 return api.sendMessage(content.chat.id,uiText(`📋 FORCE-SUBSCRIBE CHANNELS (${ids.length})\n\n`)+lines.join('\n'));
}
async function fsubAddCmd(api,content,options,arg){
 const id=Number(String(arg||'').trim());
 if(!Number.isFinite(id)||id===0)return api.sendMessage(content.chat.id,uiText('⚠️ Usage: /fsub_add <channel_id>\n\nExample: /fsub_add -1001234567890'));
 if(options.store&&typeof options.store.fsubAdd==='function')await options.store.fsubAdd(id);
 const info=await fsubChannelInfo(api,id);
 let warn='';
 if(!info.url)warn=uiText('\n\n⚠️ I could not read this channel or its invite link. Add me as an admin there (with invite-users permission) so the join button and name work.');
 return api.sendMessage(content.chat.id,uiText(`✅ Added force-subscribe channel:\n\n📢 ${escapeHtml(info.title)} — <code>${id}</code>`)+(info.url?`\n🔗 <a href="${info.url}">invite link</a>`:'' )+warn);
}
async function fsubRemoveCmd(api,content,options,arg){
 const id=Number(String(arg||'').trim());
 if(!Number.isFinite(id)||id===0)return api.sendMessage(content.chat.id,uiText('⚠️ Usage: /fsub_remove <channel_id>'));
 if(options.store&&typeof options.store.fsubRemove==='function')await options.store.fsubRemove(id);
 return api.sendMessage(content.chat.id,uiText(`✅ Removed force-subscribe channel <code>${id}</code>.`));
}
async function beginCloneFlow(api,content,options){
 const {store}=options;
 const sent=await api.sendMessage(content.chat.id,uiText('🤖 CLONE A BOT\n\nStep 1/2: send the bot token from @BotFather.\n\n⚠️ Keep it private — I will delete your message right after reading it.'),CLONE_CANCEL_KB);
 await store.setPending(content.from.id,content.chat.id,'clone_token',{prompt_chat_id:content.chat.id,prompt_message_id:sent?.message_id||null});
 return;
}
async function cloneTokenStep(api,content,token,store,options,pending){
 const clean=String(token||'').trim();
 const {chatId:pc,msgId:pm}=clonePromptOf(pending);
 await animatePrompt(api,pc,pm,['⏳ Verifying token.','⏳ Verifying token..','⏳ Verifying token...']);
 try{await api.deleteMessage(content.chat.id,content.message_id)}catch(_){}
 if(!/^\d{6,}:[\w-]{30,}$/.test(clean)){
  await setPrompt(api,pc,pm,'⚠️ That does not look like a valid bot token.\n\nSend the token from @BotFather, or cancel.',CLONE_CANCEL_KB);
  return;
 }
 let me=null;
 try{me=await new TelegramBotAPI(clean).getMe()}catch(e){logger.warn(`Clone token check failed: ${e?.message||e}`)}
 if(!me?.username){
  await setPrompt(api,pc,pm,'⚠️ Telegram rejected this token.\n\nCheck it and send again, or cancel.',CLONE_CANCEL_KB);
  return;
 }
 await store.setPending(content.from.id,content.chat.id,'clone_owner',{token:clean,username:me.username,prompt_chat_id:pc,prompt_message_id:pm});
 await setPrompt(api,pc,pm,`✅ Token accepted: @${me.username}\n\nStep 2/2: send the OWNER'S Telegram user ID — the person who will manage this cloned bot.\n\nThey can get it from @userinfobot.`,CLONE_CANCEL_KB);
 return;
}
async function cloneOwnerStep(api,content,value,store,options,pending){
 const {chatId:pc,msgId:pm}=clonePromptOf(pending);
 await animatePrompt(api,pc,pm,['⏳ Verifying ID.','⏳ Verifying ID..','⏳ Verifying ID...']);
 const ownerId=Number(String(value||'').trim());
 if(!Number.isFinite(ownerId)||ownerId<=0){
  await setPrompt(api,pc,pm,'⚠️ Send a numeric Telegram user ID.',CLONE_CANCEL_KB);
  return;
 }
 const {token,username}=pending.payload||{};
 if(!token){await store.clearPending(content.from.id);await setPrompt(api,pc,pm,'⚠️ Session expired. Start again with /clone.',null);return;}
 await animatePrompt(api,pc,pm,['⏳ Creating your clone.','⏳ Creating your clone..','⏳ Creating your clone...'],350);
 const cloneId=randomBytes(12).toString('hex'),secret=randomBytes(32).toString('hex');
 const webhookUrl=String(options.publicOrigin).replace(/\/+$/,'')+'/clone/'+cloneId;
 try{await new TelegramBotAPI(token).setWebhook(webhookUrl,secret)}
 catch(e){await store.clearPending(content.from.id);await setPrompt(api,pc,pm,`⚠️ Could not set the webhook for @${username||'the bot'}.\n\n${escapeHtml(e?.message||'Unknown error')}\n\nCheck the token and try /clone again.`,null);return;}
 await store.addClone({id:cloneId,token,ownerId,username:username||'',secret,createdBy:content.from.id});
 await store.clearPending(content.from.id);
 try{await api.deleteMessage(content.chat.id,content.message_id)}catch(_){}
 try{if(pm)await api.deleteMessage(pc,pm)}catch(_){}
 try{await api.sendMessage(ownerId,uiText(`🤖 @${username||'Your cloned bot'} is now live.\n\nManage it with /myclones (revoke anytime). Add it as admin in your channels/groups and it will react automatically.`))}catch(_){}
 return api.sendMessage(content.chat.id,uiText(`✅ CLONE CREATED\n\n🤖 @${username||cloneId}\n👤 Owner: ${ownerId}\n\nThe clone is live with a clean interface.\n\nRevoke anytime with /myclones.`));
}
async function showClones(api,content,options){
 const {store}=options;
 if(!cloneFeatureOn(store))return api.sendMessage(content.chat.id,uiText('⚠️ Clone feature needs MongoDB on the main bot.'));
 const all=await store.listClones().catch(()=>[]);
 const list=all.filter(c=>c.ownerId===content.from.id);
 if(!list.length)return api.sendMessage(content.chat.id,uiText('📭 No cloned bots found.'));
 const rows=list.map(c=>[Object.assign(uiButton(`🤖 @${c.username||c.id.slice(0,8)}`,'primary'),{callback_data:'noop'}),Object.assign(uiButton('🗑 REVOKE','danger'),{callback_data:`unclone:${c.id}`})]);
 return api.sendMessage(content.chat.id,uiText(`🤖 CLONED BOTS (${list.length})\n\nTap REVOKE to disconnect a clone permanently.`),rows);
}
async function uncloneCallback(q,api,options){
 const {store}=options;
 const answer=(text='',alert=false)=>api.answerCallbackQuery(q.id,text,alert).catch(()=>{});
 const parts=(q.data||'').split(':'),id=parts[1],confirm=parts[2];
 const clone=cloneFeatureOn(store)?await store.getClone(id).catch(()=>null):null;
 if(!clone)return answer('Clone not found.',true);
 const allowed=options.adminIds.includes(q.from.id)||clone.ownerId===q.from.id;
 if(!allowed)return answer('Not allowed.',true);
 const chatId=q.message.chat.id,msgId=q.message.message_id;
 if(confirm!=='yes'){
  await answer();
  return editPanel(api,chatId,msgId,uiText(`⚠️ REVOKE @${clone.username||clone.id}?\n\nThis deletes its Telegram webhook and removes it permanently. This cannot be undone.`),[
   [Object.assign(uiButton('✅ YES, REVOKE','danger'),{callback_data:`unclone:${id}:yes`}),Object.assign(uiButton('❌ CANCEL','primary'),{callback_data:'clback'})]
  ]);
 }
 await answer('Revoking…');
 try{await new TelegramBotAPI(clone.token).deleteWebhook()}catch(e){logger.warn(`Clone deleteWebhook failed: ${e?.message||e}`)}
 await store.removeClone(id).catch(()=>{});
 await answer('Clone revoked.',true);
 return editPanel(api,chatId,msgId,uiText(`🗑 @${clone.username||'Clone'} has been revoked and removed.`),[[Object.assign(uiButton('↩️ BACK','primary'),{callback_data:'clback'})]]);
}
async function showReactionSettings(api,content,defaults,store,options,forwarded){if(!store)return notConfigured(api,content.chat.id);let id=content.chat.id,title=content.chat.title||'this chat';if(content.chat.type==='private'){if(!forwarded)return api.sendMessage(content.chat.id,uiText('⚙️ Forward a channel post here and use /reactions, or open a connected channel from Settings.'));id=forwarded.id;title=forwarded.title||'Channel';if(!(await verifyAdmin(api,id,content.from.id)))return api.sendMessage(content.chat.id,uiText('⚠️ Channel admins only.'))}else if(!['group','supergroup','channel'].includes(content.chat.type)||!(await verifyAdmin(api,id,content.from.id)))return api.sendMessage(content.chat.id,uiText('⚠️ Admins only.'));const on=await store.isReactionsEnabled(id),r=await store.getReactions(id);return api.sendMessage(content.chat.id,uiText(`⚙️ REACTION SETTINGS — ${escapeHtml(title)}\n\nStatus: ${on?'🟢 ON':'🔴 OFF'}\nReactions: ${(r||defaults).join(' ')}\n\n💡 Custom reactions replace the default reaction list for this chat.`),[[Object.assign(uiButton(on?'🔴 TURN OFF':'🟢 TURN ON',on?'danger':'success'),{callback_data:`rs:${on?'off':'on'}:${id}`}),Object.assign(uiButton('✏️ CUSTOM','primary'),{callback_data:`input:reactions:${id}`})],[Object.assign(uiButton('🔄 RESET','primary'),{callback_data:`rs:reset:${id}`})]])}
async function setGroupReactionState(api,c,en,store){if(!(await verifyGroupAdmin(api,c)))return api.sendEphemeralMessage(c.chat.id,c.from.id,uiText('⚠️ Only group admins can change reaction settings.'));await store.setReactionsEnabled(c.chat.id,en);return api.sendEphemeralMessage(c.chat.id,c.from.id,uiText(en?'🟢 Auto reactions enabled.':'🔴 Auto reactions disabled.'))}
async function setForwardedChannelState(api,c,ch,en,store){if(!(await verifyAdmin(api,ch.id,c.from.id)))return api.sendMessage(c.chat.id,uiText('⚠️ Channel admins only.'));await store.setReactionsEnabled(ch.id,en);return api.sendMessage(c.chat.id,uiText(`${en?'🟢':'🔴'} Reactions ${en?'enabled':'disabled'} for ${ch.title||'the channel'}.`))}

async function showRequiredChannels(api,chatId,msgId,id,store){const s=await store.getGroupSettings(id),chs=getRequiredChannels(s);const rows=chs.map((c,i)=>[Object.assign(uiButton(`${i+1}. ${shortChannelName(c)}`,'primary'),{callback_data:`reqview:${id}:${i}`})]);rows.push([Object.assign(uiButton('➕ ADD CHANNEL','success'),{callback_data:`reqadd:${id}`}),Object.assign(uiButton('🔘 BUTTONS','primary'),{callback_data:`buttons:required:${id}`})]);rows.push([Object.assign(uiButton(s.required_enabled?'🟢 TURN OFF':'🔴 TURN ON',s.required_enabled?'danger':'success'),{callback_data:`reqtoggle:${id}:${s.required_enabled?0:1}`})]);rows.push([Object.assign(uiButton('🗑 REMOVE CHANNEL','danger'),{callback_data:`reqremoveone:${id}`}),Object.assign(uiButton('🗑 REMOVE ALL','danger'),{callback_data:`reqremoveall:${id}`})]);rows.push([Object.assign(uiButton('↩️ BACK TO GROUP SETTINGS','primary'),{callback_data:`open:group:${id}`})]);const text=uiText(`🔐 REQUIRED CHANNELS\n\nStatus: ${s.required_enabled&&chs.length?'🟢 ON':'🔴 OFF'}\n\n${formatRequiredChannels(chs)}\n\n💡 When ON, users must be members of every required channel before chatting.`);return editPanel(api,chatId,msgId,text,rows)}
async function buttonManager(api,chatId,msgId,id,target,store,callbackQueryId=null){
 try{
  const s=await store.getGroupSettings(id),key=buttonKey(target),b=s[key]||[];
  const rows=[[Object.assign(uiButton('➕ ADD BUTTON','success'),{callback_data:`buttonadd:${target}:${id}`})]];
  for(const [ri,row] of b.entries())for(const [ci,x] of row.entries())rows.push([Object.assign(uiButton(`🔘 ${x.text}`,'primary'),{callback_data:`bedit:${target}:${id}:${ri}:${ci}`})]);
  rows.push([Object.assign(uiButton('↕️ LAYOUT 1/ROW','primary'),{callback_data:`blayout:${target}:${id}:1`}),Object.assign(uiButton('↔️ LAYOUT 2/ROW','primary'),{callback_data:`blayout:${target}:${id}:2`})]);
  rows.push([Object.assign(uiButton('👁 PREVIEW','success'),{callback_data:`preview:${target==='join'?'join':target==='required'?'required':'welcome'}:${id}`})]);
  rows.push([Object.assign(uiButton('↩️ BACK','primary'),{callback_data:target==='required'?`reqset:${id}`:target==='join'?`open:channel:${id}`:`open:group:${id}`})]);
  return await editPanel(api,chatId,msgId,uiText(`🔘 ${target==='join'?'REQUEST':target.toUpperCase()} BUTTONS\n\nTap a button to edit it. Add as many as you need. The bot will stay here until you press Back.`),rows);
 }catch(e){
  logger.error(`Button manager error: ${e?.message||e}`);
  if(callbackQueryId)try{await api.answerCallbackQuery(callbackQueryId,'Button manager error. Please try again.',true)}catch(_){}
 }
}
const GUARD_IDX={reqdel:1,reqview:1,reqremoveone:1,reqremoveall:1,buttonadd:2,bedit:2,brename:2,blink:2,bcolor:2,bcolor_set:2,bmove:2,bdel:2,blayout:2,preview:2};
async function onCallback(q,api,options){const {store=null}=options,d=q.data||'',chatId=q.message?.chat?.id,msgId=q.message?.message_id;
 {const gp=d.split(':'),gi=GUARD_IDX[gp[0]];if(gi!==undefined){const gid=Number(gp[gi]);if(!gid||!(await verifyAdmin(api,gid,q.from.id)))return api.answerCallbackQuery(q.id,'Admins only',true)}}
 if(d==='donate'){await api.answerCallbackQuery(q.id);return sendDonate(api,chatId,options)}
 if(d==='clone'){await api.answerCallbackQuery(q.id);try{await api.deleteMessage(chatId,msgId)}catch(_){}return startClone(api,{chat:{id:chatId},from:q.from},options)}
 if(d==='help'){await api.answerCallbackQuery(q.id);const v=helpView(options);return editPanel(api,chatId,msgId,v.text,v.kb)}
 if(d==='back'){await api.answerCallbackQuery(q.id);const v=startView(q.from?.first_name,options.botUsername,options);return editPanel(api,chatId,msgId,v.text,v.kb)}
 if(d.startsWith('group_settings:')){const id=Number(d.split(':')[1]);if(!id)return api.answerCallbackQuery(q.id,'Invalid group.',true);if(!(await verifyAdmin(api,id,q.from.id)))return api.answerCallbackQuery(q.id,'You are no longer a group admin.',true);if(!store)return api.answerCallbackQuery(q.id,'Database is not configured.',true);const gch=await api.getChat(id).catch(()=>({}));await store.connect(q.from.id,id,'group',gch.title||`Group ${id}`);await api.answerCallbackQuery(q.id,'Opening group settings…');try{const privatePanel=await showGroupSettings(api,q.from.id,q.from.id,id,store,options);return privatePanel}catch(e){logger.error(`Group settings private open failed: ${e?.message||e}`);return api.sendMessage(q.from.id,uiText('⚠️ I could not open the private settings panel. Please send /groupsetting to me in private chat.'))}}
 if(d==='settings'||d==='connections'){await api.answerCallbackQuery(q.id);return showConnections(api,chatId,q.from.id,store,options,null,msgId)}
 if(d.startsWith('reqretry:')){const id=Number(d.split(':')[1]);if(!(await verifyAdmin(api,id,q.from.id)))return api.answerCallbackQuery(q.id,'Admins only',true);if(!(await verifyBotAdmin(api,id)))return api.answerCallbackQuery(q.id,'Make me an admin in this group first.',true);await store.setPending(q.from.id,id,'reqchannel',{panel_chat_id:chatId,panel_message_id:msgId,context:'required'});await api.answerCallbackQuery(q.id);return editPanel(api,chatId,msgId,uiText('➕ ADD REQUIRED CHANNEL\n\nSend @channelusername or numeric channel ID.\nFor a public link, send https://t.me/channelname.\nFor a private channel, send: channel ID | invite link.'),[[Object.assign(uiButton('❌ CANCEL','danger'),{callback_data:`reqcancel:${id}`})]])}
 if(d.startsWith('reqcancel:')){const id=Number(d.split(':')[1]);await store.clearPending(q.from.id);await api.answerCallbackQuery(q.id);return showRequiredChannels(api,chatId,msgId,id,store)}
 if(d==='inputcancel'){const p=await store.getPending(q.from.id);await store.clearPending(q.from.id);await api.answerCallbackQuery(q.id);if(p?.payload?.target)return buttonManager(api,chatId,msgId,p.chatId,p.payload.target,store);if(p?.payload?.context==='required')return showRequiredChannels(api,chatId,msgId,p.chatId,store);if(p?.payload?.channel)return showChannelSettings(api,chatId,q.from.id,p.chatId,store,options,msgId);if(['wmsg','jmsg','reactions'].includes(p?.mode))return p.mode==='jmsg'?showChannelSettings(api,chatId,q.from.id,p.chatId,store,options,msgId):showGroupSettings(api,chatId,q.from.id,p.chatId,store,options,msgId);return showConnections(api,chatId,q.from.id,store,options)}
 if(d==='bcinfo'){return api.answerCallbackQuery(q.id,'Reply to a message, then send /broadcast.',true)}
 if(d.startsWith('pick:')){const kind=d.split(':')[1],list=await store.connections(q.from.id,kind);await api.answerCallbackQuery(q.id);return editPanel(api,chatId,msgId,uiText(`⚙️ SELECT ${kind.toUpperCase()}`),list.slice(0,30).map(x=>[Object.assign(uiButton(x.title||`${kind} ${x.chat_id}`,'primary'),{callback_data:`open:${kind}:${x.chat_id}`})]).concat([[Object.assign(uiButton('↩️ BACK','primary'),{callback_data:'connections'})]]))}
 if(d.startsWith('open:')){const [,kind,id]=d.split(':');if(!(await verifyAdmin(api,Number(id),q.from.id)))return api.answerCallbackQuery(q.id,'You are no longer an admin.',true);await api.answerCallbackQuery(q.id);return kind==='group'?showGroupSettings(api,chatId,q.from.id,Number(id),store,options,msgId):showChannelSettings(api,chatId,q.from.id,Number(id),store,options,msgId)}
 if(d.startsWith('disconnect:')){const [,kind,id]=d.split(':');await store.disconnect(q.from.id,Number(id));await api.answerCallbackQuery(q.id,'Disconnected');return showConnections(api,chatId,q.from.id,store,options,null,msgId)}
 if(d.startsWith('gs:')){const [,a,idRaw,v]=d.split(':'),id=Number(idRaw);if(!(await verifyAdmin(api,id,q.from.id)))return api.answerCallbackQuery(q.id,'Admins only',true);if(a==='welcome')await store.updateGroupSettings(id,{welcome_enabled:v==='1'});else if(a==='wmode')await store.updateGroupSettings(id,{welcome_mode:v==='only_user'?'only_user':'group'});else if(a==='react')await store.setReactionsEnabled(id,v==='1');await api.answerCallbackQuery(q.id);return showGroupSettings(api,chatId,q.from.id,id,store,options,msgId)}
 if(d.startsWith('cs:')){const [,a,idRaw,v]=d.split(':'),id=Number(idRaw);if(!(await verifyAdmin(api,id,q.from.id)))return api.answerCallbackQuery(q.id,'Admins only',true);if(a==='react')await store.setReactionsEnabled(id,v==='1');else if(a==='join')await store.updateGroupSettings(id,{join_enabled:v==='1'});else if(a==='mode')await store.updateGroupSettings(id,{join_mode:v==='auto_accept'?'auto_accept':'notify'});await api.answerCallbackQuery(q.id);return showChannelSettings(api,chatId,q.from.id,id,store,options,msgId)}
 if(d.startsWith('rs:')){const [,a,idRaw]=d.split(':'),id=Number(idRaw);if(!(await verifyAdmin(api,id,q.from.id)))return api.answerCallbackQuery(q.id,'Admins only',true);if(a==='reset')await store.resetReactions(id);else await store.setReactionsEnabled(id,a==='on');await api.answerCallbackQuery(q.id);const rc=await api.getChat(id).catch(()=>null);return rc&&rc.type!=='channel'?showGroupSettings(api,chatId,q.from.id,id,store,options,msgId):showChannelSettings(api,chatId,q.from.id,id,store,options,msgId)}
 if(d.startsWith('input:')){const [,mode,idRaw,kind]=d.split(':'),id=Number(idRaw);if(!(await verifyAdmin(api,id,q.from.id)))return api.answerCallbackQuery(q.id,'Admins only',true);const prompt={wmsg:'📝 Send your welcome message.\n\nVariables: {name} {username} {mention} {group}',jmsg:'📝 Send your join-request message.\n\nVariables: {name} {username} {mention} {group}',reactions:'✏️ Send 1–20 emoji reactions.\n\nExample: 👍 ❤️ 🔥'}[mode]||'📝 Send the new value.';return beginInput(api,q,store,mode,id,prompt,{channel:kind==='channel'})}
 if(d.startsWith('reqset:')){const id=Number(d.split(':')[1]);if(!(await verifyAdmin(api,id,q.from.id)))return api.answerCallbackQuery(q.id,'Admins only',true);await api.answerCallbackQuery(q.id);return showRequiredChannels(api,chatId,msgId,id,store)}
 if(d.startsWith('reqtoggle:')){const [,idRaw,v]=d.split(':'),id=Number(idRaw),on=v==='1';if(!(await verifyAdmin(api,id,q.from.id)))return api.answerCallbackQuery(q.id,'Admins only',true);const s=await store.getGroupSettings(id),chs=getRequiredChannels(s);if(on&&!chs.length)return api.answerCallbackQuery(q.id,'Add at least one required channel first.',true);if(on&&!(await verifyBotAdmin(api,id)))return api.answerCallbackQuery(q.id,'Make me an admin in this group first.',true);await store.updateGroupSettings(id,{required_enabled:on});await api.answerCallbackQuery(q.id,on?'Required channel enforcement ON':'Required channel enforcement OFF');return showRequiredChannels(api,chatId,msgId,id,store)}
 if(d.startsWith('reqadd:')){const id=Number(d.split(':')[1]);if(!(await verifyAdmin(api,id,q.from.id)))return api.answerCallbackQuery(q.id,'Admins only',true);if(!(await verifyBotAdmin(api,id)))return api.answerCallbackQuery(q.id,'Make me an admin in this group first.',true);return beginInput(api,q,store,'reqchannel',id,'➕ ADD REQUIRED CHANNEL\n\nSend @channelusername or numeric channel ID.\nFor a public link, send https://t.me/channelname.\nFor a private channel, forward a channel post to me first.\n\nOptional: ID | invite/public link',{panel_chat_id:chatId,panel_message_id:msgId,context:'required'})}
 if(d.startsWith('reqremoveone:')){const id=Number(d.split(':')[1]),s=await store.getGroupSettings(id),chs=getRequiredChannels(s);if(!chs.length)return api.answerCallbackQuery(q.id,'No required channels configured.',true);return editPanel(api,chatId,msgId,uiText('🗑️ SELECT A REQUIRED CHANNEL TO REMOVE.'),chs.map((c,i)=>[Object.assign(uiButton(`🗑 ${i+1}. ${shortChannelName(c)}`,'danger'),{callback_data:`reqdel:${id}:${i}`})]).concat([[Object.assign(uiButton('↩️ BACK','primary'),{callback_data:`reqset:${id}`})]]))}
 if(d.startsWith('reqdel:')){const [,idRaw,idxRaw]=d.split(':'),id=Number(idRaw),idx=Number(idxRaw),s=await store.getGroupSettings(id),chs=getRequiredChannels(s);chs.splice(idx,1);await store.updateGroupSettings(id,{required_channels:chs,required_channel_id:chs[0]?.id||null,required_channel_url:chs[0]?.url||'',required_enabled:chs.length?s.required_enabled:false});await api.answerCallbackQuery(q.id,'Channel removed');return showRequiredChannels(api,chatId,msgId,id,store)}
 if(d.startsWith('reqremoveall:')){const id=Number(d.split(':')[1]);await store.updateGroupSettings(id,{required_channels:[],required_channel_id:null,required_channel_url:'',required_enabled:false});await api.answerCallbackQuery(q.id,'All required channels removed');return showRequiredChannels(api,chatId,msgId,id,store)}
 if(d.startsWith('reqcheck:')){const rp=d.split(':'),gid=Number(rp[1]),uid=q.from.id;if(rp[2]&&Number(rp[2])!==uid)return api.answerCallbackQuery(q.id,'This button is only for the muted user.',true);const s=await store.getGroupSettings(gid),chs=getRequiredChannels(s),missing=[];for(const c of chs){try{const m=await api.getChatMember(c.id,uid);if(!(['member','administrator','creator'].includes(m?.status)||(m?.status==='restricted'&&m?.is_member)))missing.push(c)}catch{}}if(missing.length)return api.answerCallbackQuery(q.id,`Join all required channels first (${missing.length} left).`,true);try{await api.restrictChatMember(gid,uid,UNMUTE_PERMISSIONS)}catch{return api.answerCallbackQuery(q.id,'I cannot unmute you. Check my group permissions.',true)}await api.answerCallbackQuery(q.id,'Verified! You can chat now.');try{await api.deleteMessage(chatId,msgId)}catch(_){}return api.sendMessage(gid,`${mention(q.from)} ${uiText('✅ has joined all required channels and can now chat.')}`)}
 if(d.startsWith('reqview:')){const [,idRaw,idxRaw]=d.split(':'),id=Number(idRaw),idx=Number(idxRaw),s=await store.getGroupSettings(id),c=getRequiredChannels(s)[idx];if(!c)return api.answerCallbackQuery(q.id,'Channel not found.',true);return editPanel(api,chatId,msgId,uiText(`📢 REQUIRED CHANNEL ${idx+1}\n\nName: ${escapeHtml(c.title||'Channel')}\nID: ${c.id}\nLink: ${c.url||'Not set'}\n\nThe bot must remain an admin in this channel.`),[[Object.assign(uiButton('🗑 REMOVE','danger'),{callback_data:`reqdel:${id}:${idx}`})],[Object.assign(uiButton('↩️ BACK','primary'),{callback_data:`reqset:${id}`})]])}
 if(d.startsWith('preview:')){const [,type,idRaw]=d.split(':'),id=Number(idRaw),s=await store.getGroupSettings(id);await api.answerCallbackQuery(q.id);if(type==='required')return api.sendMessage(chatId,uiText('🔐 REQUIRED CHANNEL PREVIEW\n\nPlease join all required channels before chatting.'),normalizeButtons(s.required_buttons));return api.sendMessage(chatId,type==='welcome'?renderTemplate(s.welcome_message||DEFAULT_WELCOME,q.from,{title:'Preview Group'}):renderTemplate(s.join_message||DEFAULT_JOIN,q.from,{title:'Preview Channel'}),normalizeButtons(type==='welcome'?s.welcome_buttons:s.join_buttons))}
 if(d.startsWith('requestbuttons:')){const id=Number(d.split(':')[1]);try{if(!store)return api.answerCallbackQuery(q.id,'Database is not configured.',true);if(!id)return api.answerCallbackQuery(q.id,'Invalid channel.',true);if(!(await verifyAdmin(api,id,q.from.id)))return api.answerCallbackQuery(q.id,'Only the channel admin can manage request buttons.',true);await api.answerCallbackQuery(q.id);return buttonManager(api,chatId,msgId,id,'join',store,q.id)}catch(e){logger.error(`Request buttons callback error: ${e?.message||e}`);try{await api.answerCallbackQuery(q.id,'Could not open request buttons.',true)}catch(_){}return null}}
 if(d.startsWith('buttons:')){const [,target,idRaw]=d.split(':'),id=Number(idRaw);try{if(!store)return api.answerCallbackQuery(q.id,'Database is not configured.',true);if(!id||!['welcome','join','required'].includes(target))return api.answerCallbackQuery(q.id,'Invalid button manager target.',true);await api.answerCallbackQuery(q.id);if(!(await verifyAdmin(api,id,q.from.id)))return editPanel(api,chatId,msgId,uiText('⚠️ Only the target chat/channel admin can manage these buttons.'),[[Object.assign(uiButton('↩️ BACK','primary'),{callback_data:target==='required'?`reqset:${id}`:target==='join'?`open:channel:${id}`:`open:group:${id}`})]]);return await buttonManager(api,chatId,msgId,id,target,store,q.id)}catch(e){logger.error(`Buttons callback error: ${e?.message||e}`);try{return await editPanel(api,chatId,msgId,uiText(`⚠️ BUTTON MANAGER ERROR\n\n${String(e?.message||'Unknown error').slice(0,180)}`),[[Object.assign(uiButton('↩️ BACK','primary'),{callback_data:target==='required'?`reqset:${id}`:target==='join'?`open:channel:${id}`:`open:group:${id}`})]])}catch(_){return null}}}
 if(d.startsWith('buttonadd:')){const [,target,idRaw]=d.split(':'),id=Number(idRaw);return beginInput(api,q,store,'button_name',id,'➕ ADD BUTTON\n\nSend the button name.\n\nExample: Support',{target})}
 if(d.startsWith('bedit:')){await api.answerCallbackQuery(q.id); const [,target,idRaw,ri,ci]=d.split(':'),id=Number(idRaw);return editPanel(api,chatId,msgId,uiText('🔘 BUTTON SETTINGS\n\nChoose what you want to change.'),[[Object.assign(uiButton('✏️ RENAME','primary'),{callback_data:`brename:${target}:${id}:${ri}:${ci}`}),Object.assign(uiButton('🔗 CHANGE LINK','primary'),{callback_data:`blink:${target}:${id}:${ri}:${ci}`})],[Object.assign(uiButton('🎨 CHANGE COLOR','primary'),{callback_data:`bcolor:${target}:${id}:${ri}:${ci}`}),Object.assign(uiButton('🗑 DELETE','danger'),{callback_data:`bdel:${target}:${id}:${ri}:${ci}`})],[Object.assign(uiButton('⬆️ MOVE UP','primary'),{callback_data:`bmove:${target}:${id}:${ri}:${ci}:up`}),Object.assign(uiButton('⬇️ MOVE DOWN','primary'),{callback_data:`bmove:${target}:${id}:${ri}:${ci}:down`})],[Object.assign(uiButton('↩️ BACK','primary'),{callback_data:`buttons:${target}:${id}`})]])}
 if(d.startsWith('brename:')||d.startsWith('blink:')){const [kind,target,idRaw,ri,ci]=d.split(':'),id=Number(idRaw);return beginInput(api,q,store,kind==='brename'?'button_edit_name':'button_edit_link',id,kind==='brename'?'✏️ Send the new button name.':'🔗 Send the new button link.\n\nExample: https://example.com',{target,ri:Number(ri),ci:Number(ci),panel_chat_id:chatId,panel_message_id:msgId})}
 if(d.startsWith('bcolor:')){await api.answerCallbackQuery(q.id); const [,target,idRaw,ri,ci]=d.split(':'),id=Number(idRaw);return editPanel(api,chatId,msgId,uiText('🎨 CHOOSE BUTTON COLOR'),[[Object.assign(uiButton('🔵 PRIMARY','primary'),{callback_data:`bcolor_set:${target}:${id}:${ri}:${ci}:primary`})],[Object.assign(uiButton('🟢 SUCCESS','success'),{callback_data:`bcolor_set:${target}:${id}:${ri}:${ci}:success`})],[Object.assign(uiButton('🔴 DANGER','danger'),{callback_data:`bcolor_set:${target}:${id}:${ri}:${ci}:danger`})],[Object.assign(uiButton('↩️ BACK','primary'),{callback_data:`bedit:${target}:${id}:${ri}:${ci}`})]])}
 if(d.startsWith('bcolor_set:')){const [,target,idRaw,ri,ci,color]=d.split(':'),id=Number(idRaw),key=buttonKey(target),s=await store.getGroupSettings(id),rows=s[key]||[];if(rows[Number(ri)]?.[Number(ci)])rows[Number(ri)][Number(ci)].style=color;await store.updateGroupSettings(id,{[key]:rows});await api.answerCallbackQuery(q.id,'Color updated');return buttonManager(api,chatId,msgId,id,target,store)}
 if(d.startsWith('bmove:')){const [,target,idRaw,ri,ci,dir]=d.split(':'),id=Number(idRaw),key=buttonKey(target),s=await store.getGroupSettings(id),flat=flattenButtons(s[key]||[]).map(x=>x.b),idx=flat.findIndex((_,i)=>{const x=flattenButtons(s[key]||[])[i];return x.ri===Number(ri)&&x.ci===Number(ci)}),to=dir==='up'?idx-1:idx+1;if(idx<0||to<0||to>=flat.length)return api.answerCallbackQuery(q.id,'Already at the edge.',true);[flat[idx],flat[to]]=[flat[to],flat[idx]];const per=Math.max(1,...(s[key]||[]).map(r=>r.length));await store.updateGroupSettings(id,{[key]:rebuildRows(flat,per>1?2:1)});await api.answerCallbackQuery(q.id,'Position updated');return buttonManager(api,chatId,msgId,id,target,store)}
 if(d.startsWith('bdel:')){const [,target,idRaw,ri,ci]=d.split(':'),id=Number(idRaw),key=buttonKey(target),s=await store.getGroupSettings(id),rows=s[key]||[];if(rows[Number(ri)])rows[Number(ri)].splice(Number(ci),1);await store.updateGroupSettings(id,{[key]:rows.filter(r=>r.length)});await api.answerCallbackQuery(q.id,'Button deleted');return buttonManager(api,chatId,msgId,id,target,store)}
 if(d.startsWith('blayout:')){const [,target,idRaw,n]=d.split(':'),id=Number(idRaw),key=buttonKey(target),s=await store.getGroupSettings(id),flat=flattenButtons(s[key]||[]).map(x=>x.b);await store.updateGroupSettings(id,{[key]:rebuildRows(flat,Number(n)===1?1:2)});await api.answerCallbackQuery(q.id,'Layout updated');return buttonManager(api,chatId,msgId,id,target,store)}
 if(d.startsWith('inputcolor:')){const color=d.split(':')[1],p=await store.getPending(q.from.id);if(!p||p.mode!=='button_color')return api.answerCallbackQuery(q.id,'Input session expired.',true);const s=await store.getGroupSettings(p.chatId),key=buttonKey(p.payload.target),rows=s[key]||[],flat=flattenButtons(rows).map(x=>x.b);if(flat.length>=16)return api.answerCallbackQuery(q.id,'Maximum 16 buttons reached.',true);flat.push({text:p.payload.name,url:p.payload.link,style:color});await store.updateGroupSettings(p.chatId,{[key]:rebuildRows(flat,2)});await store.clearPending(q.from.id);await api.answerCallbackQuery(q.id,'Button added');return buttonManager(api,chatId,msgId,p.chatId,p.payload.target,store)}
 if(d.startsWith('bc:'))return broadcastCallback(q,api,options);
 if(d==='bcx'){await api.answerCallbackQuery(q.id);return editPanel(api,chatId,msgId,uiText('❌ BROADCAST CANCELLED.'))}
 if(d==='noop')return api.answerCallbackQuery(q.id);
 if(d==='cldel'){await api.answerCallbackQuery(q.id);try{await api.deleteMessage(chatId,msgId)}catch(_){}return}
 if(d==='clcancel'){if(store)await store.clearPending(q.from.id).catch(()=>{});await api.answerCallbackQuery(q.id,'Cancelled.');try{await api.deleteMessage(chatId,msgId)}catch(_){}return}
 if(d==='fsubcheck'){
  const missing=await fsubMissing(api,q.from.id,options);
  if(!missing.length){await api.answerCallbackQuery(q.id,'Verified!');try{await api.deleteMessage(chatId,msgId)}catch(_){}return beginCloneFlow(api,{chat:{id:chatId},from:q.from},options)}
  await api.answerCallbackQuery(q.id,'Please join all channels first.',true);return;
 }
 if(d==='clback'){await api.answerCallbackQuery(q.id);return showClones(api,{chat:{id:chatId},from:q.from},options)}
 if(d.startsWith('unclone:'))return uncloneCallback(q,api,options);
 await api.answerCallbackQuery(q.id);
}

async function broadcastCallback(q,api,options){
 const {store,enqueueBroadcast}=options;
 const answer=(text='',alert=false)=>api.answerCallbackQuery(q.id,text,alert).catch(()=>{});
 try{
  if(!options.adminIds.includes(q.from.id))return answer('Not allowed',true);
  const p=(q.data||'').split(':');
  if(p.length<5)return answer('Invalid broadcast action.',true);
  const fromChatId=Number(p[1]),sourceMessageId=Number(p[2]),audience=p[3],mode=p[4],pin=p[5],action=p[6];
  if(!Number.isFinite(fromChatId)||!Number.isFinite(sourceMessageId))return answer('Invalid broadcast source.',true);
  if(!TARGETS[audience])return answer('Invalid audience.',true);
  const panelChatId=q.message.chat.id,panelMessageId=q.message.message_id;
  if(mode!=='copy'&&mode!=='forward')return answer('Invalid delivery mode.',true);
  if(pin===undefined){
   await answer();
   return editPanel(api,panelChatId,panelMessageId,uiText(`📢 ${audience.toUpperCase()}\n\n📤 MODE: ${mode.toUpperCase()}\n\nChoose pin option.`),[
    [Object.assign(uiButton('📌 PIN','success'),{callback_data:`bc:${fromChatId}:${sourceMessageId}:${audience}:${mode}:1`}),Object.assign(uiButton('🚫 WITHOUT PIN','primary'),{callback_data:`bc:${fromChatId}:${sourceMessageId}:${audience}:${mode}:0`})],
    [Object.assign(uiButton('❌ CANCEL','danger'),{callback_data:'bcx'})]
   ]);
  }
  if(pin!=='1'&&pin!=='0')return answer('Invalid pin option.',true);
  if(!store||!enqueueBroadcast)return answer('Broadcast service is not configured.',true);
  await answer('🚀 Broadcasting…');
  let total=0;
  try{total=Number(await store.audienceCount(audience))||0}catch(e){return editPanel(api,panelChatId,panelMessageId,errorText({sent:0,failed:0,removed:0},e)).catch(()=>{});}
  if(total<=0)return editPanel(api,panelChatId,panelMessageId,uiText('⚠️ NO RECIPIENTS FOUND\n\nThere are no valid recipients in the selected audience.')).catch(()=>{});
  const job={audience,kinds:TARGETS[audience],fromChatId,messageId:sourceMessageId,statusChatId:panelChatId,statusMessageId:panelMessageId,afterId:Number.MIN_SAFE_INTEGER,total,sent:0,failed:0,removed:0,startedAt:Date.now(),mode,pin:pin==='1'};
  await editStatus(api,job,progressText(job));
  try{await enqueueBroadcast(job)}catch(e){await editStatus(api,job,errorText(job,e));}
 }catch(e){
  logger.error(`Broadcast callback error: ${e?.message||e}`);
  return answer(`Broadcast error: ${String(e?.message||'Unknown error').slice(0,150)}`,true);
 }
}

function getRequiredChannels(s){
 const list=Array.isArray(s?.required_channels)?s.required_channels.filter(c=>c&&c.id):[];
 if(list.length)return list.map(c=>({id:Number(c.id),url:c.url||'',title:c.title||''}));
 if(s?.required_channel_id)return [{id:Number(s.required_channel_id),url:s.required_channel_url||'',title:''}];
 return [];
}
function shortChannelName(c){
 const raw=String(c?.title||'').trim()||(c?.url?String(c.url).replace(/^https?:\/\/t\.me\//i,'@'):String(c?.id||'Channel'));
 return raw.length>28?raw.slice(0,27)+'…':raw;
}
function formatRequiredChannels(chs){
 return chs.length?chs.map((c,i)=>`${i+1}. ${String(c.title||'Channel').replace(/[<>&]/g,'')}`).join('\n'):'No required channels added yet.';
}
