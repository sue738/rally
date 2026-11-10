// カメラで撮る: beside +file. The app shows the camera in a sheet with 撮る (app/Sources/Rally/Camera.swift) and saves
// the photo as an attachment; the page asks, and puts the chip in the box. Only in the app: a browser has no bridge
// to a camera sheet, so the button is not drawn there.
const camWait=new Map();   // token → the box that asked
function cameraBtn(cls,inner){
  return native?'<button class="'+cls+' cambtn" title="'+t('カメラで撮って添付(この Mac のカメラ、または近くの iPhone)')+'" aria-label="'+t('カメラで撮る')+'">'+inner+'</button>':'';
}
const CAM_ICON='<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M2.2 5.2h2.3l1-1.6h5l1 1.6h2.3v7.2H2.2z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="8" cy="8.7" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
function cameraAsk(box){
  if(!native||!box||!box.querySelector('.atts'))return;
  const token='cam'+Date.now()+Math.random();camWait.set(token,box);
  attachLog('camera asked');post({type:'camera',token});
}
function cameraResult(r){
  let box=camWait.get(r.token);camWait.delete(r.token);
  // the panel was redrawn while the sheet was up: the box now on screen takes the photo
  if(!box||!box.isConnected||!box.querySelector('.atts'))box=$('#mbody');
  if(!box||r.cancelled)return;
  if(r.error||!r.path){
    // the box's own line, not toast(): that would also unlock a send button
    const line=box.querySelector('.toast');if(line)line.textContent=r.error||t('撮れませんでした');
    attachLog('camera failed: '+(r.error||''));return}
  const name=r.name||r.path.split('/').pop();
  const chip=attachChip(box,name,'file://'+encodeURI(r.path));if(!chip)return;
  chip.dataset.path=r.path;chip.querySelector('.n').textContent=name;attachLog('camera saved: '+name);
  if(chip.closest('#mbody'))keepUnsent();
  const ta=box.querySelector('.msg textarea, #ntext');if(ta)ta.focus();
}
