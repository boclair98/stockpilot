// Development-time only. The deployed application serves the resulting PNG;
// neither the build nor a visitor needs to contact Google Fonts.
import { createElement as h } from 'react';
import { ImageResponse } from 'next/og.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const phrases = ['StockPilot', '실제 시세로,', '내 돈 없이 투자 연습', '한국·미국 주식', '모의주문', '기록과 복기', 'stockpilot.coders.kr', '01', '02', '03'];
const fontCss = await fetch(`https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@700&text=${encodeURIComponent(phrases.join(' '))}`, {signal:AbortSignal.timeout(20000)});
if (!fontCss.ok) throw new Error(`Font CSS request failed (${fontCss.status})`);
const fontUrl = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)\s*format\('truetype'\)/.exec(await fontCss.text())?.[1];
if (!fontUrl) throw new Error('Expected a Google Fonts TrueType subset. Keep the existing PNG if the provider format changes.');
const fontReply = await fetch(fontUrl, {signal:AbortSignal.timeout(20000)});
if (!fontReply.ok) throw new Error(`Font request failed (${fontReply.status})`);
const font = await fontReply.arrayBuffer();

const response = new ImageResponse(h('div', {style:{width:'100%',height:'100%',display:'flex',flexDirection:'column',padding:'60px 72px',background:'#f7f9fc',fontFamily:'Noto',fontWeight:700,color:'#172333',borderLeft:'14px solid #2463eb'}},
  h('div',{style:{display:'flex',alignItems:'center',gap:14,fontSize:30}},
    h('div',{style:{display:'flex',alignItems:'flex-end',justifyContent:'center',gap:5,width:46,height:46,padding:11,borderRadius:13,background:'#2463eb'}}, ...[12,23,17].map((height,i)=>h('div',{key:i,style:{width:4,height,background:'#fff',borderRadius:2}}))), 'StockPilot'),
  h('div',{style:{display:'flex',flexDirection:'column',marginTop:54,fontSize:63,lineHeight:1.3,letterSpacing:-2}},
    h('div',null,'실제 시세로,'), h('div',{style:{color:'#1f56c9'}},'내 돈 없이 투자 연습')),
  h('div',{style:{display:'flex',alignItems:'center',gap:30,marginTop:42,fontSize:22,color:'#637184'}},
    ...['한국·미국 주식','모의주문','기록과 복기'].map((text,i)=>h('div',{key:text,style:{display:'flex',alignItems:'center',gap:10}},h('span',{style:{color:'#1f56c9',fontSize:17}},`0${i+1}`),text))),
  h('div',{style:{display:'flex',marginTop:'auto',fontSize:18,color:'#637184'}},'stockpilot.coders.kr')
), {width:1200,height:630,fonts:[{name:'Noto',data:font,weight:700,style:'normal'}]});

const target = fileURLToPath(new URL('../public/social/stockpilot.png', import.meta.url));
await mkdir(path.dirname(target),{recursive:true});
await writeFile(target,Buffer.from(await response.arrayBuffer()));
console.log('Generated public/social/stockpilot.png (1200×630, no account or quote data)');
