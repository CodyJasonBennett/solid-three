import * as THREE from 'three'
import { createRenderer } from 'solid-js/universal'

export type ConstructorRepresentation = new (...args: any[]) => any
export type Catalogue = Record<string, ConstructorRepresentation>

export interface EventHandlers {}
export type Attach<O = any> = string | ((parent: any, self: O) => () => void)
export type Args<T> = T extends ConstructorRepresentation ? ConstructorParameters<T> : any[]

export interface InstanceProps<T = any, P = any> {
  [key: string]: unknown
  args?: Args<P>
  object?: T
  dispose?: null
  attach?: Attach<T>
}

export interface Instance<O = any> {
  type: string
  parent: Instance | null
  children: Instance[]
  object: O | null
  props: InstanceProps<O>
}

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
function attach(parent: Instance, child: Instance): void {
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
function detach(parent: Instance, child: Instance): void {
  if (typeof child.props.attach === 'string') {
    const { root, key } = resolve(parent.object, child.props.attach)
    root[key] = child.object.__previousAttach
  } else if (typeof child.props.attach === 'function') {
    child.object.__previousAttach(parent.object, child.object)
  }

  delete child.object.__previousAttach
}

// Internal instance props that shouldn't be written to objects
const RESERVED_PROPS = ['args', 'object', 'dispose', 'attach']

/**
 * Safely mutates a THREE element, respecting special JSX syntax.
 */
function applyProps<O = any>(object: O, props: InstanceProps<O>): void {
  for (const prop in props) {
    // Skip reserved keys
    if (RESERVED_PROPS.includes(prop)) continue

    // Resolve dash-case props if able
    const value = props[prop]
    const { root, key, target } = resolve(object, prop)

    // Prefer to use properties' copy and set methods.
    // Otherwise, mutate the property directly
    if (!target?.set) root[key] = value
    else if (target.copy && target.constructor === (value as Object).constructor) target.copy(value)
    else if (Array.isArray(value)) target.set(...value)
    else if (!(target instanceof THREE.Color) && target.setScalar) target.setScalar(value)
    else target.set(value)
  }
}

const catalogue: Catalogue = {}
/**
 * Extends the THREE catalogue, accepting an object of keys pointing to external classes.
 */
export const extend = (objects: Partial<Catalogue>): void => void Object.assign(catalogue, objects)

export const renderer = createRenderer<Instance>({
  createElement(type) {
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
        if (!child.props.object) throw new Error('"object" must be set when using primitives!')

        // Link object
        child.object = child.props.object
      } else {
        // Validate target
        const target = catalogue[child.type.charAt(0).toUpperCase() + child.type.substring(1)]
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

    // Add or manually splice child
    if (child.props.attach) {
      attach(parent, child)
    } else if (parent.object instanceof THREE.Object3D && child.object instanceof THREE.Object3D) {
      const objectIndex = parent.object.children.indexOf(beforeChild?.object)
      if (objectIndex !== -1) {
        this.removeNode(parent, beforeChild!)

        child.object.parent = parent.object
        parent.object.children.splice(objectIndex, 0, child.object)
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
    } else if (parent.object instanceof THREE.Object3D && child.object instanceof THREE.Object3D) {
      parent.object.remove(child.object)
    }

    // Safely dispose of object
    if (child.props.dispose !== null && child.type !== 'primitive') child.object.dispose?.()
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

type Mutable<T> = { [K in keyof T]: T[K] | Readonly<T[K]> }
type NonFunctionKeys<T> = { [K in keyof T]: T[K] extends Function ? never : K }[keyof T]
type Overwrite<T, O> = Omit<T, NonFunctionKeys<O>> & O

interface MathRepresentation {
  set(...args: number[]): any
}
interface VectorRepresentation extends MathRepresentation {
  setScalar(s: number): any
}
type MathType<T extends MathRepresentation | THREE.Euler> = T extends THREE.Color
  ? ConstructorParameters<typeof THREE.Color> | THREE.ColorRepresentation
  : T extends VectorRepresentation | THREE.Layers | THREE.Euler
  ? T | Parameters<T['set']> | number
  : T | Parameters<T['set']>
type WithMathProps<P> = { [K in keyof P]: P[K] extends MathRepresentation | THREE.Euler ? MathType<P[K]> : P[K] }

interface RaycastableRepresentation {
  raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void
}
type EventProps<P> = P extends RaycastableRepresentation ? Partial<EventHandlers> : {}

type ElementProps<T extends ConstructorRepresentation, P = InstanceType<T>> = Partial<
  Overwrite<WithMathProps<P>, EventProps<P>>
>

export type ThreeElement<T extends ConstructorRepresentation> = Mutable<
  Overwrite<ElementProps<T>, Omit<InstanceProps<InstanceType<T>, T>, 'object'>>
>

type ThreeExports = typeof THREE
type ThreeElementsImpl = {
  [K in keyof ThreeExports as Uncapitalize<K>]: ThreeExports[K] extends ConstructorRepresentation
    ? ThreeElement<ThreeExports[K]>
    : never
}

export interface ThreeElements extends ThreeElementsImpl {
  primitive: Omit<ThreeElement<any>, 'args'> & { object: object }
}

declare global {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}
