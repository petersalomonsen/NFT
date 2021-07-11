import * as THREE from 'https://cdn.skypack.dev/three@0.130.1';

let camera, scene, renderer;
let geometry, material;
let positionPlane;
let visualizationTime = 0;
init();

function init() {
    camera = new THREE.PerspectiveCamera( 70, window.innerWidth / window.innerHeight, 0.01, 10 );
    camera.position.z = 0;
    scene = new THREE.Scene();

    const geometry = new THREE.PlaneGeometry( 1.0, 1.0 );
    const material = new THREE.MeshBasicMaterial( {color: 0x010022, transparent: true, opacity: 0.7, side: THREE.DoubleSide} );
    positionPlane = new THREE.Mesh( geometry, material );
    scene.add(positionPlane);
    
    camera.lookAt( positionPlane.position );

    renderer = new THREE.WebGLRenderer( { antialias: true } );
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.setAnimationLoop( animation );
    renderer.domElement.style.position = 'fixed';
    renderer.domElement.style.top = 0;
    renderer.domElement.style.bottom = 0;
    renderer.domElement.style.margin = 0;
    renderer.domElement.style.zIndex = -1000;
    renderer.domElement.style.width = '100%';
    document.body.appendChild( renderer.domElement );
}

export function insertVisualizationObjects(visualizationObjects) {
    visualizationObjects.forEach((visualizationObject) => {
        geometry = new THREE.BoxGeometry( 0.01, visualizationObject.velocityValue / 127 * 0.01, visualizationObject.duration);
        material = new THREE.MeshNormalMaterial();
        const mesh = new THREE.Mesh( geometry, material );
        mesh.position.z = -visualizationObject.time - visualizationObject.duration / 2;
        mesh.position.x = ((visualizationObject.channel + 1) / 16) * ( (visualizationObject.channel % 2) ? -1 : 1);
        mesh.position.y = visualizationObject.noteNumber / 127 - 0.5;
        scene.add( mesh );
    });
}

export function setVisualizationTime(time) {
    visualizationTime = time;
    positionPlane.position.z = -time;
}

function animation(time) {
    camera.position.x = Math.cos(time / 2000) * 0.1;
    camera.position.y = Math.sin(time / 4000) * 0.1;
    camera.position.z = -visualizationTime + 0.7;
    renderer.render( scene, camera );
}