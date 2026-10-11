import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.STOCKPILOT_PLAYWRIGHT||'playwright');
const base=process.env.STOCKPILOT_VERIFY_URL||'https://stockpilot.coders.kr';
const output=process.env.STOCKPILOT_VERIFY_OUTPUT;
if(!output)throw new Error('STOCKPILOT_VERIFY_OUTPUT required');
await mkdir(output,{recursive:true});
const browser=await chromium.launch();
try{for(const width of [1440,390]){const page=await browser.newPage({viewport:{width,height:width===390?844:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('stockpilot_onboarding_v2','done'));const response=await page.goto(base,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForTimeout(3000);await page.screenshot({path:`${output}/before-${width}.png`});console.log(JSON.stringify({width,http:response.status(),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),errors,text:(await page.locator('body').innerText()).slice(0,600)}));await page.close();}}finally{await browser.close();}
