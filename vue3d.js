// 3D illustration of the forecast over the Chaltén massif (Three.js).
// Loaded on demand by index.html. mount(el) builds the scene inside `el`; the returned show(f) sets the hour to display.
import * as THREE from "three";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";

const UTC_OFFSET=-3; // Argentina: UTC−3, no DST
const FITZ={lat:-49.2714,lon:-73.0431};
const EXAG=1.15;     // slight vertical exaggeration: flat-looking otherwise at this scale
const MAIN_LABELS=["Fitz Roy","Cerro Torre","Guillaumet"];

// ---------- sun position (NOAA approximation) ----------
function sunPos(dateUTC,lat,lon){
  const rad=Math.PI/180,d=(dateUTC-Date.UTC(2000,0,1,12))/864e5;
  const g=(357.529+0.98560028*d)*rad,q=280.459+0.98564736*d,L=(q+1.915*Math.sin(g)+0.020*Math.sin(2*g))*rad,e=(23.439-0.00000036*d)*rad;
  const ra=Math.atan2(Math.cos(e)*Math.sin(L),Math.cos(L)),dec=Math.asin(Math.sin(e)*Math.sin(L));
  const gmst=(18.697374558+24.06570982441908*d)%24,H=(gmst*15+lon)*rad-ra;
  const alt=Math.asin(Math.sin(lat*rad)*Math.sin(dec)+Math.cos(lat*rad)*Math.cos(dec)*Math.cos(H));
  const az=Math.atan2(-Math.sin(H),Math.tan(dec)*Math.cos(lat*rad)-Math.sin(lat*rad)*Math.cos(H)); // from north, clockwise
  return {alt,az};
}
// iOS WebKit generates garbage mipmaps for sRGB textures (coloured blotches): white sprite textures need neither
function noMip(t){t.generateMipmaps=false;t.minFilter=THREE.LinearFilter;t.magFilter=THREE.LinearFilter;return t}
function texPuff(){const c=document.createElement("canvas");c.width=c.height=128;const x=c.getContext("2d");
  for(let k=0;k<7;k++){const px=40+Math.random()*48,py=44+Math.random()*40,r=26+Math.random()*26,g=x.createRadialGradient(px,py,0,px,py,r);
    g.addColorStop(0,"rgba(255,255,255,.55)");g.addColorStop(1,"rgba(255,255,255,0)");x.fillStyle=g;x.fillRect(0,0,128,128)}
  return noMip(new THREE.CanvasTexture(c))}
function texDot(){const c=document.createElement("canvas");c.width=c.height=32;const x=c.getContext("2d"),g=x.createRadialGradient(16,16,0,16,16,16);
  g.addColorStop(0,"rgba(255,255,255,1)");g.addColorStop(.5,"rgba(255,255,255,.6)");g.addColorStop(1,"rgba(255,255,255,0)");x.fillStyle=g;x.fillRect(0,0,32,32);return noMip(new THREE.CanvasTexture(c))}

export async function mount(el,{base="3d/"}={}){
  const phone=matchMedia("(max-width:599px)").matches;
  const [meta,buf,peaks]=await Promise.all([fetch(base+"relief.json").then(r=>r.json()),fetch(base+"relief.bin").then(r=>r.arrayBuffer()),fetch(base+"peaks.json").then(r=>r.json())]);
  const heights=new Uint16Array(buf);
  const SX=(meta.E-meta.W)*111.32*Math.cos(49.3*Math.PI/180), SZ=(meta.N-meta.S)*111.32; // km
  const pos=(lat,lon,altM)=>new THREE.Vector3((lon-meta.W)/(meta.E-meta.W)*SX-SX/2,altM/1000*EXAG,(meta.N-lat)/(meta.N-meta.S)*SZ-SZ/2);
  const hAt=(x,z)=>{ // terrain height (km, exaggerated) at scene x/z, bilinear
    const u=(x+SX/2)/SX*(meta.w-1),v=(z+SZ/2)/SZ*(meta.h-1);
    const i=Math.max(0,Math.min(meta.w-2,Math.floor(u))),j=Math.max(0,Math.min(meta.h-2,Math.floor(v))),fu=u-i,fv=v-j,g=(a,b)=>heights[b*meta.w+a];
    return((g(i,j)*(1-fu)+g(i+1,j)*fu)*(1-fv)+(g(i,j+1)*(1-fu)+g(i+1,j+1)*fu)*fv)/1000*EXAG};

  // ---------- renderer, camera, controls ----------
  const renderer=new THREE.WebGLRenderer({antialias:!phone,powerPreference:"high-performance",precision:"highp"});
  renderer.setPixelRatio(Math.min(devicePixelRatio,phone?1.5:2));
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=phone?THREE.PCFShadowMap:THREE.PCFSoftShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.outputColorSpace=THREE.SRGBColorSpace;
  el.appendChild(renderer.domElement);
  const scene=new THREE.Scene();scene.fog=new THREE.FogExp2(0x8fb8dd,0.01);
  const camera=new THREE.PerspectiveCamera(45,1,0.1,400);
  // Default view: from above the Río de las Vueltas, east of the village, looking west at the Fitz–Torre skyline
  const target=phone?new THREE.Vector3(0.61,0.64,-1.09):new THREE.Vector3(1.66,-0.17,0.34);
  if(phone)camera.position.set(20.74,5.36,3.31);else camera.position.set(17.78,3.99,-1.29);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.target.copy(target);controls.enableDamping=true;controls.zoomSpeed=2.4;controls.rotateSpeed=0.8;
  controls.minDistance=3;controls.maxDistance=55;controls.maxPolarAngle=Math.PI*0.48;
  // Touch: one finger turns, two fingers zoom; the page does not scroll while the finger is on the 3D
  controls.touches={ONE:THREE.TOUCH.ROTATE,TWO:THREE.TOUCH.DOLLY_ROTATE};
  renderer.domElement.style.touchAction="none";

  // ---------- terrain ----------
  const geo=new THREE.PlaneGeometry(SX,SZ,phone?255:383,phone?133:200);geo.rotateX(-Math.PI/2);
  const P=geo.attributes.position;for(let k=0;k<P.count;k++)P.setY(k,hAt(P.getX(k),P.getZ(k)));
  geo.computeVertexNormals();
  const sat=await new THREE.TextureLoader().loadAsync(base+"sat.jpg");
  sat.colorSpace=THREE.SRGBColorSpace;sat.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  const iOS=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
  if(iOS)noMip(sat); // same WebKit sRGB-mipmap bug
  const terrain=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({map:sat,roughness:0.95,metalness:0}));
  terrain.castShadow=terrain.receiveShadow=true;scene.add(terrain);
  const skirt=new THREE.Mesh(new THREE.BoxGeometry(SX,0.3,SZ),new THREE.MeshStandardMaterial({color:0x1a2229}));skirt.position.y=-0.16;scene.add(skirt);

  // ---------- lights ----------
  const sun=new THREE.DirectionalLight(0xffffff,3);sun.castShadow=true;
  sun.shadow.mapSize.set(phone?1024:2048,phone?1024:2048);Object.assign(sun.shadow.camera,{left:-22,right:22,top:22,bottom:-22,near:1,far:120});sun.shadow.bias=-0.0006;
  scene.add(sun,sun.target);
  const hemi=new THREE.HemisphereLight(0xbfd6ff,0x3a3024,0.6);scene.add(hemi);
  const sunRef=new THREE.Vector3(0.5,1.4,-3.2); // Fitz Roy: shadows are framed around it

  // ---------- clouds ----------
  const PUFFS=[texPuff(),texPuff(),texPuff()];
  const layer=(n,y0,y1,s0,s1,max)=>{const g=new THREE.Group();g.userData.max=max;
    for(let k=0;k<n;k++){const s=new THREE.Sprite(new THREE.SpriteMaterial({map:PUFFS[k%3],transparent:true,depthWrite:false,opacity:0,fog:true,alphaTest:0.01}));
      const sc=s0+Math.random()*(s1-s0);s.scale.set(sc*1.8,sc*0.8,1);
      s.position.set((Math.random()-.5)*SX*1.3,y0+Math.random()*(y1-y0),(Math.random()-.5)*SZ*1.3);s.userData.r=Math.random();g.add(s)}
    scene.add(g);return g};
  const LOW=layer(110,0.9,2.0,2.5,5,0.55),MID=layer(110,3.2,4.4,3.5,7,0.42),HIGH=layer(40,7.5,8.5,10,16,0.3);

  // ---------- wind streaks ----------
  // Wind: camera-facing ribbons (WebGL ignores line width), bright head fading to a transparent tail
  const NW=phone?320:500,wpos=new Float32Array(NW*12),wcol=new Float32Array(NW*16),wseed=new Float32Array(NW*4),widx=[];
  for(let k=0;k<NW;k++){wseed[k*4]=(Math.random()-.5)*SX;wseed[k*4+1]=2.4+Math.random()*1.6;wseed[k*4+2]=(Math.random()-.5)*SZ;wseed[k*4+3]=Math.random();
    const b=k*4;widx.push(b,b+1,b+2,b+1,b+3,b+2);
    wcol.set([1,1,1,1, 1,1,1,1, 0.6,0.8,1,0, 0.6,0.8,1,0],k*16)}
  const wgeo=new THREE.BufferGeometry();wgeo.setAttribute("position",new THREE.BufferAttribute(wpos,3));wgeo.setAttribute("color",new THREE.BufferAttribute(wcol,4));wgeo.setIndex(widx);
  const wmat=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide,fog:false,toneMapped:false});
  const wmesh=new THREE.Mesh(wgeo,wmat);wmesh.frustumCulled=false;scene.add(wmesh);
  const wdir=new THREE.Vector3(),wview=new THREE.Vector3(),wperp=new THREE.Vector3();

  // ---------- precipitation ----------
  const NP=phone?2500:4000,ppos=new Float32Array(NP*3),pcol=new Float32Array(NP*3);
  for(let k=0;k<NP;k++){ppos[k*3]=(Math.random()-.5)*SX;ppos[k*3+1]=Math.random()*6;ppos[k*3+2]=(Math.random()-.5)*SZ}
  const pgeo=new THREE.BufferGeometry();pgeo.setAttribute("position",new THREE.BufferAttribute(ppos,3));pgeo.setAttribute("color",new THREE.BufferAttribute(pcol,3));
  const pmat=new THREE.PointsMaterial({size:0.05,map:texDot(),vertexColors:true,transparent:true,opacity:0,depthWrite:false,alphaTest:0.01});scene.add(new THREE.Points(pgeo,pmat));

  // ---------- labels ----------
  const lbox=document.createElement("div");lbox.className="v3-labels";el.appendChild(lbox);
  const LBLS=[...peaks.filter(p=>MAIN_LABELS.includes(p.name)).map(p=>({t:`${p.name} ${p.alt}`,p:pos(p.lat,p.lon,p.alt)})),{t:"El Chaltén",p:pos(-49.3314,-72.8866,420),v:1}];
  LBLS.forEach(l=>{l.el=document.createElement("div");l.el.className="v3-lbl"+(l.v?" v":"");l.el.textContent=l.t;lbox.appendChild(l.el)});

  // ---------- state from the forecast hour ----------
  const W={dx:0,dz:0,speed:0},C={low:0,mid:0,high:0},R={rate:0,iso:3};
  const cSky=new THREE.Color(),cTmp=new THREE.Color();
  // f: {time:"YYYY-MM-DDTHH:00", w700, dir700, low, mid, high, precip, iso}
  function show(f){
    const to=((f.dir700??270)+180)*Math.PI/180;W.speed=f.w700??0;W.dx=Math.sin(to);W.dz=-Math.cos(to);
    C.low=(f.low??0)/100;C.mid=(f.mid??0)/100;C.high=(f.high??0)/100;R.rate=f.precip??0;R.iso=(f.iso??1500)/1000*EXAG;
    const [Y,M,D]=f.time.slice(0,10).split("-").map(Number),hr=+f.time.slice(11,13);
    const s=sunPos(Date.UTC(Y,M-1,D,hr-UTC_OFFSET,0),FITZ.lat,FITZ.lon);
    const up=Math.sin(s.alt),dayK=THREE.MathUtils.smoothstep(up,-0.08,0.15),dusk=Math.max(0,1-Math.abs(up-0.05)/0.18);
    sun.position.set(sunRef.x+Math.sin(s.az)*Math.cos(s.alt)*60,sunRef.y+Math.max(0.02,up)*60,sunRef.z-Math.cos(s.az)*Math.cos(s.alt)*60);sun.target.position.copy(sunRef);
    const overcast=Math.max(C.low*0.9,C.mid*0.8,Math.min(1,R.rate));
    sun.intensity=3.2*dayK*(1-0.75*overcast);sun.color.setRGB(1,0.82+0.18*(1-dusk),0.62+0.38*(1-dusk));
    hemi.intensity=0.08+0.65*dayK;
    cSky.set(0x0b1320).lerp(cTmp.set(0xe7a36c),dusk*dayK).lerp(cTmp.set(0x8fb8dd),dayK*(1-dusk)).lerp(cTmp.set(0x8e969c),overcast*dayK*0.85);
    scene.background=cSky.clone();scene.fog.color.copy(cSky);scene.fog.density=0.004+0.018*Math.max(C.low*C.low,Math.min(1,R.rate*1.5));
    const tint=new THREE.Color(0x2a3440).lerp(new THREE.Color(0xffffff),0.25+0.75*dayK).lerp(new THREE.Color(0xffc9a0),dusk*0.6*dayK).lerp(new THREE.Color(0x9aa3aa),overcast*0.5);
    [[LOW,C.low],[MID,C.mid],[HIGH,C.high*0.6]].forEach(([g,cov])=>g.children.forEach(sp=>{sp.material.color.copy(tint);sp.userData.target=sp.userData.r<cov?g.userData.max*(0.6+0.4*cov):0}));
    return {sunAlt:s.alt*180/Math.PI};
  }

  // ---------- render loop: runs only while the panel is on screen ----------
  let visible=true,raf=0;
  const resize=()=>{const w=el.clientWidth,h=el.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix()};
  new ResizeObserver(resize).observe(el);resize();
  const clock=new THREE.Clock(),v3=new THREE.Vector3();
  function tick(){
    raf=0;if(!visible)return;
    const dt=Math.min(0.05,clock.getDelta()),drift=W.speed/60;
    for(const g of [LOW,MID,HIGH])for(const sp of g.children){const k=g===HIGH?1.6:1;
      sp.position.x+=W.dx*drift*dt*k;sp.position.z+=W.dz*drift*dt*k;
      if(sp.position.x>SX*.65)sp.position.x-=SX*1.3;if(sp.position.x<-SX*.65)sp.position.x+=SX*1.3;
      if(sp.position.z>SZ*.65)sp.position.z-=SZ*1.3;if(sp.position.z<-SZ*.65)sp.position.z+=SZ*1.3;
      const o=sp.material.opacity,tg=sp.userData.target||0;sp.material.opacity=o+(tg-o)*Math.min(1,dt*2.5)}
    // more, longer and brighter streaks as the wind rises; always clearly visible from ~10 km/h
    const len=0.5+W.speed/30,active=W.speed<5?0:Math.round(NW*Math.min(1,0.15+W.speed/70));wmat.opacity=Math.min(0.95,0.55+W.speed/120);
    wdir.set(W.dx,0,W.dz);
    for(let k=0;k<NW;k++){let x=wseed[k*4],z=wseed[k*4+2];const y=wseed[k*4+1],sp=0.7+wseed[k*4+3];
      x+=W.dx*drift*3*dt*sp;z+=W.dz*drift*3*dt*sp;if(x>SX/2)x-=SX;if(x<-SX/2)x+=SX;if(z>SZ/2)z-=SZ;if(z<-SZ/2)z+=SZ;
      wseed[k*4]=x;wseed[k*4+2]=z;
      if(k>=active){wpos.fill(0,k*12,k*12+12);continue}
      const yy=Math.max(y,hAt(x,z)+0.2);
      if(Math.hypot(x-camera.position.x,yy-camera.position.y,z-camera.position.z)<3){wpos.fill(0,k*12,k*12+12);continue}
      // width grows with distance so streaks keep a few pixels on screen
      wview.set(x-camera.position.x,yy-camera.position.y,z-camera.position.z);const dist=wview.length();
      wperp.crossVectors(wdir,wview);if(wperp.lengthSq()<1e-6){wpos.fill(0,k*12,k*12+12);continue}
      wperp.normalize().multiplyScalar(Math.min(0.045,0.0028*dist*(phone?1.3:1)));
      const tx=x-W.dx*len,tz=z-W.dz*len;
      wpos.set([x+wperp.x,yy+wperp.y,z+wperp.z, x-wperp.x,yy-wperp.y,z-wperp.z, tx+wperp.x,yy+wperp.y,tz+wperp.z, tx-wperp.x,yy-wperp.y,tz-wperp.z],k*12)}
    wgeo.attributes.position.needsUpdate=true;
    const rate=Math.min(1,R.rate/1.5);pmat.opacity=rate>0.01?0.85:0;
    if(rate>0.01){const n=Math.round(NP*Math.min(1,0.15+rate));
      for(let k=0;k<NP;k++){let x=ppos[k*3],y=ppos[k*3+1],z=ppos[k*3+2];const snow=y>R.iso;
        y-=(snow?0.9:4)*dt;x+=W.dx*drift*(snow?1.2:0.4)*dt;z+=W.dz*drift*(snow?1.2:0.4)*dt;
        if(k>=n||y<hAt(x,z)){x=(Math.random()-.5)*SX;z=(Math.random()-.5)*SZ;y=k<n?5+Math.random()*1.5:-9}
        ppos[k*3]=x;ppos[k*3+1]=y;ppos[k*3+2]=z;
        if(snow){pcol[k*3]=pcol[k*3+1]=pcol[k*3+2]=1}else{pcol[k*3]=0.55;pcol[k*3+1]=0.7;pcol[k*3+2]=0.95}}
      pgeo.attributes.position.needsUpdate=true;pgeo.attributes.color.needsUpdate=true}
    controls.update();renderer.render(scene,camera);
    const w=el.clientWidth,h=el.clientHeight;
    for(const l of LBLS){v3.copy(l.p).project(camera);const on=v3.z<1&&Math.abs(v3.x)<1.05&&Math.abs(v3.y)<1.05;
      l.el.style.display=on?"block":"none";if(on){l.el.style.left=(v3.x+1)/2*w+"px";l.el.style.top=(1-v3.y)/2*h+"px"}}
    raf=requestAnimationFrame(tick);
  }
  new IntersectionObserver(e=>{visible=e[0].isIntersecting;if(visible&&!raf){clock.getDelta();raf=requestAnimationFrame(tick)}}).observe(el);
  raf=requestAnimationFrame(tick);
  return {show,camera,controls}; // camera/controls exposed for tuning the default view
}
