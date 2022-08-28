import { render } from './renderer'

const onResize = () => render(<gridHelper args={[4, 4]} />, document.querySelector('canvas')!)
window.addEventListener('resize', onResize)
onResize()
