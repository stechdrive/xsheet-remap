import { expect, test } from './fixtures'
import { activateControl } from './input'
import { createDefaultProject, createProjectDocumentFromCutProject, createTimedRangeCue } from '../../../packages/core/src/index'
import { encodeProjectArchive } from '../../../packages/adapters/src/projectArchive'
import { createDefaultDialogueAudioCutState, updateDialogueAudioCutStateInProject } from '../../../packages/ui/src/dialogueAudioProject'
import { addDialogueAudioTrack, regionsForDialogueClips } from '../../../packages/ui/src/dialogueAudioCommands'
import { bindDialogueRegionsToCue } from '../../../packages/ui/src/dialogueAudioBinding'
import { pcmToWavBlob } from '../../../packages/ui/src/dialogueAudioEngine'

async function archive(count: number) {
  let project=createDefaultProject(), state=createDefaultDialogueAudioCutState(1)
  const left=Float32Array.from({length:48000},(_,i)=>Math.sin(i*.04)*.02), right=Float32Array.from(left,value=>-value)
  const wave=await pcmToWavBlob({samples:new Float32Array(48000),channels:[left,right],sampleRate:12000}).arrayBuffer()
  state.assets=[{assetId:'stereo',audioDataUrl:`data:audio/wav;base64,${Buffer.from(wave).toString('base64')}`,durationFrames:96,waveform:[.1,.5,.2,.4],sourceName:'stereo.wav'}]
  for(let i=state.tracks.length;i<count;i++)state=addDialogueAudioTrack(state)
  state={...state,activeTrackId:'dialogue-1',tracks:state.tracks.map((track,i)=>({...track,vadMode:'off',clips:i<count?[{clipId:`clip-${i}`,placementId:`placement-${i}`,assetId:'stereo',timelineStartFrame:13,sourceOffsetFrames:12,durationFrames:48}]:[]}))}
  const created=createTimedRangeCue(project,{role:'sound',laneId:'sound_lane_1',frameStart:7,frameEnd:72,label:'収録枠'})
  project=created.project
  const regions=regionsForDialogueClips(state,[{trackId:'dialogue-1',clipId:'clip-0'}])
  state=bindDialogueRegionsToCue(regions.state,regions.refs,created.cue,createProjectDocumentFromCutProject(project).cuts[0].activeRevisionId,project.timedRangeCues)
  project=updateDialogueAudioCutStateInProject(project,state,1)
  return Buffer.from(await encodeProjectArchive(createProjectDocumentFromCutProject(project),{includeAssetPreviews:true}))
}

test('clip editing preserves the independent SOUND window and atomic undo',async({page},info)=>{
  await page.goto('./')
  await activateControl(page,page.getByLabel('画面切替',{exact:true}))
  await page.getByRole('button',{name:'プロジェクトを開く…',exact:true}).setInputFiles({name:'audio.xsr',mimeType:'application/octet-stream',buffer:await archive(1)})
  const collapsed=page.getByRole('region',{name:'セリフ音声タイムライン'})
  const collapsedBox=await collapsed.boundingBox(), playBox=await collapsed.getByRole('button',{name:'カット頭から再生',exact:true}).boundingBox()
  expect(playBox!.y+playBox!.height).toBeLessThanOrEqual(collapsedBox!.y+collapsedBox!.height)
  await activateControl(page,page.getByRole('button',{name:'音声タイムラインを開く'}))
  const timeline=page.getByRole('region',{name:'セリフ音声タイムライン'})
  const clip=timeline.getByRole('button',{name:'音声クリップ stereo.wav'})
  await expect(clip).toBeVisible()
  const box=await clip.boundingBox(); expect(box!.height).toBeGreaterThan(24)
  await activateControl(page,clip)
  const start=timeline.getByLabel('クリップ開始',{exact:true})
  await start.fill('25');await start.press('Enter')
  await expect(clip).toHaveAttribute('data-frame-start','25')
  await expect(timeline.getByRole('button',{name:'SOUND 収録枠 19–84F'})).toBeVisible()
  await activateControl(page,timeline.getByRole('button',{name:'元に戻す',exact:true}))
  await expect(clip).toHaveAttribute('data-frame-start','13')
  await expect(timeline.getByRole('button',{name:'SOUND 収録枠 7–72F'})).toBeVisible()
  await activateControl(page,timeline.getByRole('button',{name:'SOUND 収録枠 7–72F'}))
  await timeline.getByLabel('SOUNDの追従方法',{exact:true}).selectOption('fixed')
  await activateControl(page,clip)
  await start.fill('25');await start.press('Enter')
  await expect(timeline.getByRole('button',{name:'SOUND 収録枠 7–72F'})).toBeVisible()
  await expect(timeline.getByText('前 +18F / 後 0F',{exact:true})).toBeVisible()
  await activateControl(page,timeline.getByRole('button',{name:'元に戻す',exact:true}))
  await expect(clip).toHaveAttribute('data-frame-start','13')
  await expect(timeline.getByText('前 +6F / 後 +12F',{exact:true})).toBeVisible()
  await timeline.getByLabel('SOUNDの追従方法',{exact:true}).selectOption('follow-audio')
  await activateControl(page,timeline.getByRole('button',{name:'スナップ',exact:true}))
  const resize=await timeline.getByRole('separator',{name:'音声タイムラインの高さを変更',exact:true}).boundingBox()
  await page.mouse.move(resize!.x+resize!.width/2,resize!.y+resize!.height/2)
  await page.mouse.down();await page.mouse.move(resize!.x+resize!.width/2,resize!.y-160,{steps:8});await page.mouse.up()
  const restored=await clip.boundingBox(), x=restored!.x+restored!.width/2,y=restored!.y+restored!.height/2, delta=restored!.width/4
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+delta,y,{steps:6})
  await expect(clip).toHaveAttribute('data-frame-start','25')
  await page.keyboard.press('Escape');await page.mouse.up()
  await expect(clip).toHaveAttribute('data-frame-start','13')
  await expect(timeline.locator('.dialogueAudioClipGhost')).toHaveCount(0)
  const target=await timeline.locator('.dialogueAudioTrack[data-track-id="dialogue-2"]').boundingBox()
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+delta,target!.y+20,{steps:8});await page.mouse.up()
  await expect(clip).toHaveAttribute('data-track-id','dialogue-2')
  await expect(clip).toHaveAttribute('data-frame-start','25')
  await expect(timeline.getByRole('button',{name:'SOUND 収録枠 19–84F'})).toBeVisible()
  await activateControl(page,timeline.getByRole('button',{name:'元に戻す',exact:true}))
  const edge=await clip.locator('[data-clip-edge="end"]').boundingBox()
  await page.mouse.move(edge!.x+edge!.width/2,edge!.y+edge!.height/2);await page.mouse.down()
  await page.mouse.move(edge!.x+edge!.width/2-delta,edge!.y+edge!.height/2,{steps:6});await page.mouse.up()
  await expect(clip).toHaveAttribute('data-frame-end','48')
  await expect(timeline.getByRole('button',{name:'SOUND 収録枠 7–60F'})).toBeVisible()
  await activateControl(page,timeline.getByRole('button',{name:'元に戻す',exact:true}))
  await activateControl(page,timeline.getByRole('button',{name:'レーザーツール（C）',exact:true}))
  await activateControl(page,clip)
  await expect(clip).toHaveCount(2)
  await expect(timeline.getByRole('button',{name:'SOUND 収録枠 7–72F'})).toHaveCount(1)
  await activateControl(page,timeline.getByRole('button',{name:'元に戻す',exact:true}))
  await activateControl(page,timeline.getByRole('button',{name:'選択ツール',exact:true}))
  await activateControl(page,timeline.getByRole('button',{name:'音声トラック1をソロ',exact:true}))
  await expect(timeline.getByRole('button',{name:'音声トラック1をソロ',exact:true})).toHaveAttribute('aria-pressed','true')
  await activateControl(page,timeline.getByRole('button',{name:'＋トラック'}))
  await expect(timeline.getByLabel('音声トラック4の名前')).toHaveValue('音声 4')
  if(info.project.name.endsWith('-touch')){
    await activateControl(page,clip,'touch')
    await expect(timeline).toHaveAttribute('data-input-modality','touch')
    await activateControl(page,timeline.getByRole('button',{name:'音声トラック1をソロ',exact:true}),'touch')
    await expect(timeline.getByRole('button',{name:'音声トラック1をソロ',exact:true})).toHaveAttribute('aria-pressed','false')
    await activateControl(page,timeline.getByRole('button',{name:'音声トラック1をロック',exact:true}),'touch')
    await expect(timeline.getByRole('button',{name:'音声トラック1をロック',exact:true})).toHaveAttribute('aria-pressed','true')
  }
  const bounds=await timeline.evaluate(element=>({width:element.clientWidth,scroll:element.scrollWidth,body:element.querySelector('.dialogueAudioBody')!.clientHeight}))
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);expect(bounds.body).toBeGreaterThan(80)
  await page.screenshot({path:info.outputPath('audio-clips.png')})
})

test('32 tracks schedule real stereo playback and solo restricts the audible set @isolated',async({page},info)=>{
  await page.addInitScript(()=>{
    const counts:number[]=[];Object.assign(window,{__audioChannels:counts})
    if(typeof AudioBufferSourceNode==='undefined')return
    const start=AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start=function(...args:Parameters<typeof start>){counts.push(this.buffer?.numberOfChannels??0);return start.apply(this,args)}
  })
  await page.goto('./')
  await activateControl(page,page.getByLabel('画面切替',{exact:true}))
  await page.getByRole('button',{name:'プロジェクトを開く…',exact:true}).setInputFiles({name:'32-tracks.xsr',mimeType:'application/octet-stream',buffer:await archive(32)})
  await activateControl(page,page.getByRole('button',{name:'音声タイムラインを開く'}))
  await expect(page.locator('.dialogueAudioTrack')).toHaveCount(32)
  const supportsAudio=await page.evaluate(()=>typeof AudioContext==='function')
  if(!supportsAudio){await info.attach('audio-availability',{body:'This Playwright WebKit build has no Web Audio; track geometry only.',contentType:'text/plain'});return}
  await activateControl(page,page.getByRole('button',{name:'▶ 再生ヘッドから',exact:true}))
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'__audioChannels'))).toEqual(Array(32).fill(2))
  await activateControl(page,page.getByRole('button',{name:'⏸ 一時停止',exact:true}))
  await activateControl(page,page.getByRole('button',{name:'音声トラック1をソロ',exact:true}))
  await activateControl(page,page.getByRole('button',{name:'⏮ カット頭から',exact:true}))
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'__audioChannels').length)).toBe(33)
  await activateControl(page,page.getByRole('button',{name:'⏸ 一時停止',exact:true}))
})
