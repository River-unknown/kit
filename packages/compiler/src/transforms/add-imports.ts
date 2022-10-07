/*
 * For a given adaptor, add import statements
 *    - load the d.ts for that adaptor
 *    - import every export
 *    - maybe only import the things we need
 *
 * This needs to accept an external argument
 * This will only work with 2.0 adaptors with type defs
 */
import { builders as b, namedTypes as n } from 'ast-types';
import type { NodePath } from 'ast-types/lib/node-path';
import type { ASTNode } from 'ast-types';
import { visit } from 'recast';
import type { Transformer } from '../transform';
import type { Logger } from '@openfn/logger';

const GLOBALS =
  /^(state|console|JSON|setInterval|clearInterval|setTimeout|clearTimeout|parseInt|parseFloat|atob|btoa)$/;

export type AddImportsOptions = {
  // Adaptor MUST be pre-populated for this transformer to actually do anything
  adaptor: {
    name: string;
    exports?: string[];
    exportAll?: boolean;
  };
};

export type IdentifierList = Record<string, true>;

// Find a list of all identifiers that haven't been declared in this AST
export function findAllDanglingIdentifiers(ast: ASTNode) {
  const result: IdentifierList = {};
  visit(ast, {
    visitIdentifier: function (path) {
      // If this is the top object of a member expression
      if (n.MemberExpression.check(path.parentPath.node)) {
        // If this identifier is the subject of any part of an expression chain, it's not a dangler
        let target = path;
        let parent = path.parentPath;
        while (parent.node.property) {
          // Check if target node is a property
          if (parent.node.property === target.node) {
            // If so, abort traversal
            return false;
          }
          // Step up the tree
          target = parent;
          parent = parent.parentPath;
        }
      }
      // If this identifier is a key in a property, abort
      if (
        n.Property.check(path.parentPath.node) &&
        n.Identifier.check(path.parentPath.node.key) &&
        path.parentPath.node.key.name === path.node.name
      ) {
        return false;
      }
      // If this identifier was declared in this scope, ignore it
      let scope = path.scope;
      while (scope) {
        if (scope.declares(path.node.name)) {
          return false;
        }
        scope = scope.parent;
      }
      result[path.node.name] = true;
      this.traverse(path);
    },
  });
  return result;
}

function visitor(path: NodePath, logger: Logger, options: AddImportsOptions) {
  if (options.adaptor) {
    const { name, exports, exportAll } = options.adaptor;
    if (name) {
      const identifiers = findAllDanglingIdentifiers(path.node);
      const usedExports =
        exports && exports.length
          ? // If we have exports for this adaptor, import any dangling variables from the export list
            exports.filter((e) => identifiers[e])
          : // If we have no exports for this adaptor, import anything apart from a few choice globals
            Object.keys(identifiers).filter((i) => !i.match(GLOBALS));
      if (usedExports.length) {
        // TODO maybe in trace output we can say WHY we're doing these things
        addUsedImports(path, usedExports, name);
        logger.info(`Added import statement for ${name}`);
        if (exportAll) {
          addExportAdaptor(path, name);
          logger.info(`Added export * statement for ${name}`);
        }
      }
    }
  }
}

// Add an import statement to pull in the named values from an adaptor
function addUsedImports(
  path: NodePath,
  imports: string[],
  adaptorName: string
) {
  // TODO add trace output
  const i = b.importDeclaration(
    imports.map((e) => b.importSpecifier(b.identifier(e))),
    b.stringLiteral(adaptorName)
  );
  path.get('body').insertAt(0, i);
}

// Add an export all statement
function addExportAdaptor(path: NodePath, adaptorName: string) {
  const e = b.exportAllDeclaration(b.stringLiteral(adaptorName), null);
  path.get('body').insertAt(1, e);
}

export default {
  id: 'add-imports',
  types: ['Program'],
  visitor,
} as Transformer;
