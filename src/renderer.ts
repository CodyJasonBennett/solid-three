import * as THREE from 'three'
import { createRenderer } from 'solid-js/universal'

export interface EventHandlers {}

/**
 * Describes how to attach an element via a property or set of add & remove callbacks.
 */
export type Attach<O = any> = string | ((parent: any, self: O) => () => void)

type Mutable<T> = { [K in keyof T]: T[K] | Readonly<T[K]> }
type NonFunctionKeys<T> = { [K in keyof T]: T[K] extends Function ? never : K }[keyof T]
type WithoutFunctions<T> = Pick<T, NonFunctionKeys<T>>
type Overwrite<T, O> = Omit<T, NonFunctionKeys<O>> & O
type ConstructorRepresentation = new (...args: any[]) => any
type Args<T> = T extends ConstructorRepresentation ? ConstructorParameters<T> : T

interface MathRepresentation {
  set(...args: any[]): any
}
interface VectorRepresentation extends MathRepresentation {
  setScalar(s: number): any
}
type MathProps<T> = {
  [K in keyof T]: T[K] extends infer M
    ? M extends THREE.Color
      ? ConstructorParameters<typeof THREE.Color> | THREE.ColorRepresentation
      : M extends MathRepresentation
      ? M extends VectorRepresentation
        ? M | Parameters<M['set']> | Parameters<M['setScalar']>[0]
        : M | Parameters<M['set']>
      : {}
    : never
}

interface RaycastableRepresentation {
  raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void
}
type EventProps<T> = T extends RaycastableRepresentation ? EventHandlers : {}

type ThreeNodeProps<T, P = T extends Function ? T['prototype'] : {}> = {
  args?: Args<T>
  attach?: Attach<P>
  object?: T
} & Partial<MathProps<P> & EventProps<P>>

interface ThreeNode<O = any> {
  type: string
  parent: ThreeNode | null
  children: ThreeNode[]
  object: O | null
  props: ThreeNodeProps<O>
}

export type Node<T extends Function> = Mutable<Overwrite<Partial<WithoutFunctions<T['prototype']>>, ThreeNodeProps<T>>>

type ThreeExports = typeof THREE
export type ThreeElements = {
  [K in keyof ThreeExports as Uncapitalize<K>]: ThreeExports[K] extends ConstructorRepresentation
    ? Omit<Node<ThreeExports[K]>, 'object'>
    : never
}

declare global {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {
      primitive: Omit<Node<any>, 'args'>
    }
  }
}

/**
 * Converts camelCase primitives to PascalCase.
 */
const toPascalCase = (str: string): string => str.charAt(0).toUpperCase() + str.substring(1)

/**
 * Resolves a potentially pierced key type against an object.
 */
function resolve(
  root: any,
  key: string,
): {
  root: any
  key: string
  target: any
} {
  let target = root[key]
  if (!key.includes('-')) return { root, key, target }

  // Resolve pierced target
  const chain = key.split('-')
  target = chain.reduce((acc, key) => acc[key], root)
  key = chain.pop()!

  // Switch root if atomic
  if (!target?.set) root = chain.reduce((acc, key) => acc[key], root)

  return { root, key, target }
}

// Checks if a dash-cased string ends with an integer
const INDEX_REGEX = /-\d+$/

/**
 * Attaches an node to a parent via its `attach` prop.
 */
function attach(parent: ThreeNode, child: ThreeNode): void {
  if (typeof child.props.attach === 'string') {
    // If attaching into an array (foo-0), create one
    if (INDEX_REGEX.test(child.props.attach)) {
      const target = child.props.attach.replace(INDEX_REGEX, '')
      const { root, key } = resolve(parent.object, target)
      if (!Array.isArray(root[key])) root[key] = []
    }

    const { root, key } = resolve(parent.object, child.props.attach)
    child.object.__previousAttach = root[key]
    root[key] = child.object
  } else if (typeof child.props.attach === 'function') {
    child.object.__previousAttach = child.props.attach(parent.object, child.object)
  }
}

/**
 * Removes an node from a parent via its `attach` prop.
 */
function detach(parent: ThreeNode, child: ThreeNode): void {
  if (typeof child.props.attach === 'string') {
    const { root, key } = resolve(parent.object, child.props.attach)
    root[key] = child.object.__previousAttach
  } else if (typeof child.props.attach === 'function') {
    child.object.__previousAttach(parent.object, child.object)
  }

  delete child.object.__previousAttach
}

// Internal instance props that shouldn't be written to objects
const RESERVED_PROPS = ['args', 'attach', 'object']

/**
 * Safely mutates a THREE element, respecting special JSX syntax.
 */
function applyProps<O = any>(object: ThreeNode<O>['object'], props: ThreeNodeProps<O>): void {
  for (const prop in props) {
    // Skip reserved keys
    if (RESERVED_PROPS.includes(prop)) continue

    // Resolve pierced props if able
    const value = props[prop]
    const { root, key, target } = resolve(object, prop)

    // Prefer to use properties' copy and set methods.
    // Otherwise, mutate the property directly
    if (target?.set) {
      if (target.constructor === (value as Object).constructor) {
        target.copy(value)
      } else if (Array.isArray(value)) {
        target.set(...value)
      } else if (!(target instanceof THREE.Color) && target.setScalar) {
        // Allow shorthand like scale={1}
        target.setScalar(value)
      } else {
        target.set(value)
      }
    } else {
      root[key] = value
    }
  }
}

const catalogue = THREE as unknown as Record<string, ConstructorRepresentation>

/**
 * Extends the THREE catalogue, accepting an object of keys pointing to external classes.
 */
export const extend = (objects: Partial<ThreeElements>): void => void Object.assign(catalogue, objects)

const renderer = createRenderer<ThreeNode>({
  createElement(type: string) {
    return {
      type,
      parent: null,
      children: [],
      object: null,
      props: { args: [] },
    }
  },
  setProperty(node, key, value) {
    // Write prop to node
    node.props[key] = value

    // If at runtime, apply prop directly to the object
    if (node.object) applyProps(node.object, { [key]: value })
  },
  insertNode(parent, child, beforeChild) {
    // Create object on first commit
    if (!child.object) {
      if (child.type === 'primitive') {
        // Validate primitive
        if (child.type === 'primitive' && !child.props.object)
          throw new Error('"object" must be set when using primitives!')

        // Link object
        child.object = child.props.object
      } else {
        // Validate target
        const target = catalogue[toPascalCase(child.type)]
        if (!target) throw new Error(`${child.type} is not a part of the THREE catalog! Did you forget to extend?`)

        // Create object
        child.object = new target(...(child.props.args ?? []))
      }

      // Auto-attach geometry and materials
      if (child.props.attach === undefined) {
        if (child.object instanceof THREE.BufferGeometry) child.props.attach = 'geometry'
        else if (child.object instanceof THREE.Material) child.props.attach = 'material'
      }

      // Set initial props
      applyProps(child.object, child.props)
    }

    // Link nodes
    child.parent = parent
    parent.children.push(child)

    if (child.props.attach) {
      attach(parent, child)
    } else if (child.object instanceof THREE.Object3D) {
      // If a previous child is specified, manually insert before it.
      // Otherwise, use regular Object3D#add
      if (beforeChild) {
        child.object.parent = parent.object
        parent.object.children.splice(parent.children.indexOf(beforeChild.object), 0, child.object)
        child.object.dispatchEvent({ type: 'added' })
      } else {
        parent.object.add(child.object)
      }
    }
  },
  removeNode(parent, child) {
    // Unlink child node
    child.parent = null
    const childIndex = parent.children.indexOf(child)
    if (childIndex !== -1) parent.children.splice(childIndex, 1)

    // Remove object from parent
    if (child.props.attach) {
      detach(parent, child)
    } else if (child.object instanceof THREE.Object3D) {
      parent.object.remove(child.object)
    }

    // Safely dispose of object (defer since PMREM disposal is blocking)
    if (child.type !== 'primitive') requestIdleCallback(() => child.object.dispose?.())
  },
  getParentNode(node) {
    return node.parent ?? undefined
  },
  getFirstChild(node) {
    return node.children[0]
  },
  getNextSibling(node) {
    const index = node.parent!.children.indexOf(node)
    return node.children[index + 1]
  },
  createTextNode() {
    throw new Error('Text is not allowed in the tree! This could be stray characters or whitespace.')
  },
  replaceText() {},
  isTextNode() {
    return false
  },
})

export interface RootState {
  gl: THREE.WebGLRenderer
  camera: THREE.PerspectiveCamera
  scene: THREE.Scene
}

interface Root {
  container: ThreeNode<THREE.Scene>
  state: RootState
}

// Store roots here since we can render to multiple targets
const roots = new WeakMap<HTMLCanvasElement, Root>()

/**
 * Renders Solid elements into THREE elements.
 */
export function render(element: ThreeNode, canvas: HTMLCanvasElement): RootState {
  let root = roots.get(canvas)

  // Initiate root
  if (!root) {
    // Create renderer
    const gl = new THREE.WebGLRenderer({
      canvas,
      powerPreference: 'high-performance',
      antialias: true,
      alpha: true,
    })
    gl.setPixelRatio(2)

    // Set artist-friendly color management defaults
    gl.outputEncoding = THREE.sRGBEncoding
    gl.toneMapping = THREE.ACESFilmicToneMapping

    // Create camera
    const camera = new THREE.PerspectiveCamera(75, 0, 0.1, 1000)
    camera.position.set(0, 1.3, 3)

    // Create scene
    const scene = new THREE.Scene()

    // Start render loop
    gl.setAnimationLoop(() => gl.render(scene, camera))

    // Init root
    root = {
      state: { gl, camera, scene },
      container: {
        type: 'container',
        parent: null,
        children: [],
        object: scene,
        props: {},
      },
    }
    roots.set(canvas, root)
  }

  // Set initial size
  const width = canvas.parentElement?.clientWidth ?? 0
  const height = canvas.parentElement?.clientHeight ?? 0
  root.state.gl.setSize(width, height)
  root.state.camera.aspect = width / height
  root.state.camera.updateProjectionMatrix()

  // Render
  renderer.render(() => element, root.container)

  return root.state
}

export const {
  effect,
  memo,
  createComponent,
  createElement,
  createTextNode,
  insertNode,
  insert,
  spread,
  setProp,
  mergeProps,
} = renderer

export { For, Show, Suspense, SuspenseList, Switch, Match, Index, ErrorBoundary } from 'solid-js'
