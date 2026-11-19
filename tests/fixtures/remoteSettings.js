// Remote settings signed with a key made for these tests alone (its private
// half was thrown away): `tauri signer sign`, as the real ones are.
export const PUBLIC_KEY = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDc4ODJBMUQyNjFFOTYyQjgKUldTNFl1bGgwcUdDZUFqcFAybFcrdFBzdmJGcXhZcUdGdSsvK1d5RE9RaWVPRytlc1FjbW1sL1IK"

export const TAKEN = {
  text: "{\"serial\":2,\"patches\":[{\"id\":\"planning-off\",\"university\":\"univ-rennes\",\"features\":{\"planning\":false}},{\"id\":\"cas-moved\",\"university\":\"univ-rennes\",\"apps\":[\"ios\"],\"maxVersion\":\"0.27.2\",\"server\":{\"origins\":{\"cas\":\"https://sso2.univ-rennes.fr\"}},\"client\":{\"note\":\"moved\"}},{\"id\":\"cas-stolen\",\"university\":\"univ-rennes\",\"server\":{\"origins\":{\"cas\":\"https://sso.example.org\"}}},{\"id\":\"other\",\"university\":\"univ-rennes-2\",\"features\":{\"mail\":false}}]}",
  signature: "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTNFl1bGgwcUdDZURFRHFSdGpiZ0FGTW50S201d3RFQVFaeWtVeTVZRGdkanZpVGsyTXB4MVlDOUdHUlBQR0dnN3UyR0xUQk1peUUvMGgwa3hwZ3BOalNDTDlTVTFZQ2c0PQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk0ODI2MTcwCWZpbGU6VEFLRU4uanNvbgpDc0pFVHM3ekdPN2xQTzluNExqSnBMbm0xLzlGb0U5SGhWbEVLSlFUcWtHYXgxUlhWeE1ETnloaGFRRTA4Um1ydmVPcnlpUFhIaTlzOTlaUU9XbTFCUT09Cg==",
}

export const NEWER = {
  text: "{\"serial\":3,\"patches\":[]}",
  signature: "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTNFl1bGgwcUdDZUJBbVh2OE5aTVFudUtjTUI5bExJOHBBclFSNzVMRDFZd1FQVmZ5RVlTcDFrdFRqdHB2WU5KcEJYbkhmOFVaTTh6bmg0SVB0eEorc3lEdHpwOTJJalF3PQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk0ODI2MTcwCWZpbGU6TkVXRVIuanNvbgpXTmVwdkNJZUNrd0x3N1RGNmpMVU1RR3lmc2NwVGtHc0F3NWp2ZWk2UlBkQ0VtdmIvZmx4UWluRFR0aksrdHViY3hjdnBzcGJnTlJSWXdyQ2tQTUlEZz09Cg==",
}

export const OLDER = {
  text: "{\"serial\":1,\"patches\":[{\"id\":\"old\",\"university\":\"univ-rennes\",\"features\":{\"mail\":false}}]}",
  signature: "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTNFl1bGgwcUdDZUE3aTJOZkYwTG9sRHJ4ZVhTY3NOSkVhT3FyVStMT3pkZVU5dXkxQzY3SEpVenNYL0QzQ1Q2eDRnYzJUanB3LytFQ0FDR2FFZ2NIakRnc3Vjbm5SY1FnPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk0ODI2MTcwCWZpbGU6T0xERVIuanNvbgpWYzJ4OG1zVS9Na3JmUFFSd1J4YitsMGhKTVl4OExzejRMdGZwU3RNN24rSFZnczhuMTBKRmZhWkVaS3p5K3hQelpvMm1XNjdHeWJWcGFVazR0amtCdz09Cg==",
}
