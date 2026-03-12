export type NPCESeriesItem = {
  lineNumber: number
  label: string
  depth: number
}

export const NPCE_SERIES: NPCESeriesItem[] = [
  { lineNumber: 1,  label: 'Personal Consumption Expenditures (PCE)',                                          depth: 0 },
  { lineNumber: 2,  label: 'Goods',                                                                            depth: 1 },
  { lineNumber: 3,  label: 'Durable Goods',                                                                    depth: 2 },
  { lineNumber: 4,  label: 'Motor Vehicles and Parts',                                                         depth: 3 },
  { lineNumber: 5,  label: 'Furnishings and Durable Household Equipment',                                      depth: 3 },
  { lineNumber: 6,  label: 'Recreational Goods and Vehicles',                                                  depth: 3 },
  { lineNumber: 7,  label: 'Other Durable Goods',                                                              depth: 3 },
  { lineNumber: 8,  label: 'Nondurable Goods',                                                                 depth: 2 },
  { lineNumber: 9,  label: 'Food and Beverages Purchased for Off-Premises Consumption',                        depth: 3 },
  { lineNumber: 10, label: 'Clothing and Footwear',                                                            depth: 3 },
  { lineNumber: 11, label: 'Gasoline and Other Energy Goods',                                                  depth: 3 },
  { lineNumber: 12, label: 'Other Nondurable Goods',                                                           depth: 3 },
  { lineNumber: 13, label: 'Services',                                                                         depth: 1 },
  { lineNumber: 14, label: 'Household Consumption Expenditures (for Services)',                                depth: 2 },
  { lineNumber: 15, label: 'Housing and Utilities',                                                            depth: 3 },
  { lineNumber: 16, label: 'Health Care',                                                                      depth: 3 },
  { lineNumber: 17, label: 'Transportation Services',                                                          depth: 3 },
  { lineNumber: 18, label: 'Recreation Services',                                                              depth: 3 },
  { lineNumber: 19, label: 'Food Services and Accommodations',                                                 depth: 3 },
  { lineNumber: 20, label: 'Financial Services and Insurance',                                                 depth: 3 },
  { lineNumber: 21, label: 'Other Services',                                                                   depth: 3 },
  { lineNumber: 22, label: 'Final Consumption Expenditures of NPISHs',                                        depth: 2 },
  { lineNumber: 23, label: 'Gross Output of Nonprofit Institutions',                                          depth: 3 },
  { lineNumber: 24, label: 'Less: Receipts from Sales of Goods and Services by Nonprofit Institutions',       depth: 3 },
  // Addenda
  { lineNumber: 25, label: 'PCE Excluding Food and Energy',                                                   depth: 1 },
  { lineNumber: 26, label: 'PCE Excluding Food, Energy, and Housing',                                         depth: 1 },
  { lineNumber: 27, label: 'Energy Goods and Services',                                                       depth: 1 },
  { lineNumber: 28, label: 'PCE Services Excluding Energy and Housing',                                       depth: 1 },
  { lineNumber: 29, label: 'Housing',                                                                         depth: 1 },
  { lineNumber: 30, label: 'Market-Based PCE',                                                                depth: 1 },
  { lineNumber: 31, label: 'Market-Based PCE Excluding Food and Energy',                                      depth: 1 },
]
