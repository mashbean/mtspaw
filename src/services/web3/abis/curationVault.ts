const curationVaultAbi = [
  {
    inputs: [
      { internalType: 'string', name: 'uid_', type: 'string' },
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

export { curationVaultAbi }
