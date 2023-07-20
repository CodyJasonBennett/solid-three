import * as THREE from 'three'
import { extend, renderer as reconciler } from './renderer'

const renderer = new THREE.WebGLRenderer({ alpha: true })
renderer.setSize(window.innerWidth, window.innerHeight)
document.body.appendChild(renderer.domElement)

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight)
camera.position.set(0, 1.3, 3)

const scene = new THREE.Scene()

extend({ GridHelper: THREE.GridHelper })
reconciler.render(() => <gridHelper args={[4, 4]} />, {
  type: '',
  parent: null,
  children: [],
  object: scene,
  props: {},
})

renderer.render(scene, camera)
