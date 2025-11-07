'use strict'

// Shared constants used by driver helpers

// Accept pages without an extension or with well-known HTML-like extensions
const extensions = /^([^.]+$|\.(asp|aspx|cgi|htm|html|jsp|php)$)/

module.exports = { extensions }
