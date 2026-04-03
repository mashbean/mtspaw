import { Command } from 'commander'

const helloCommand = new Command('hello').description('Say hello').action(() => {
  console.log('hello paw ~')
})

export { helloCommand }
