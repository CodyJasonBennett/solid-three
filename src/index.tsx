import * as THREE from 'three'
import { extend, render } from './renderer'

const renderer = new THREE.WebGLRenderer({ alpha: true })
renderer.setSize(window.innerWidth, window.innerHeight)
document.body.appendChild(renderer.domElement)

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight)
camera.position.set(0, 1.3, 3)

const scene = new THREE.Scene()

extend({ GridHelper: THREE.GridHelper })
render(<gridHelper ref={console.log} args={[4, 4]} />, scene)

renderer.render(scene, camera)
