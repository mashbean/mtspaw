const curationAbi = [
  {
    inputs: [
      { internalType: 'address', name: 'to_', type: 'address' },
      { internalType: 'contract IERC20', name: 'token_', type: 'address' },
      { internalType: 'uint256', name: 'amount_', type: 'uint256' },
      { internalType: 'string', name: 'uri_', type: 'string' },
    ],
    name: 'curate',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const

export { curationAbi }
