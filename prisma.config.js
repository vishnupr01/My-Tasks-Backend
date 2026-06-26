"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = require("node:path");
const config_1 = require("prisma/config");
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)({ path: node_path_1.default.join(__dirname, '.env') });
exports.default = (0, config_1.defineConfig)({
    schema: node_path_1.default.join(__dirname, 'prisma/schema.prisma'),
    datasource: {
        url: process.env.DATABASE_URL,
    },
});
//# sourceMappingURL=prisma.config.js.map