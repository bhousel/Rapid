/**
 * JavaScript XML Object Notation - bidirectional conversion between XML and JavaScript objects.
 * @see https://developer.mozilla.org/en-US/docs/JXON
 */

/** Parsed value types from XML text content */
type ParsedValue = null | boolean | number | Date | string;

/** Result of building an object tree from XML */
type JxonObject = Record<string, any>;


/**
 * Represents an empty XML node with null-like behavior.
 */
class EmptyTree {
  public toString(): string { return 'null'; }
  public valueOf(): null { return null; }
}


/**
 * Provides static methods for converting between XML and JavaScript objects.
 */
export class JXON {
  protected static readonly _VALUE_PROP = 'keyValue';
  protected static readonly _ATTRIBUTES_PROP = 'keyAttributes';
  protected static readonly _ATTR_PREFIX = '@';
  protected static readonly _RE_IS_NULL = /^\s*$/;
  protected static readonly _RE_IS_BOOL = /^(?:true|false)$/i;

  /** Cache used during tree building */
  protected static _cache: Element[] = [];


  /**
   * Parse text content into appropriate JavaScript type.
   */
  protected static _parseText(sValue: string): ParsedValue {
    if (JXON._RE_IS_NULL.test(sValue)) { return null; }
    if (JXON._RE_IS_BOOL.test(sValue)) { return sValue.toLowerCase() === 'true'; }
    if (isFinite(Number(sValue))) { return parseFloat(sValue); }
    if (isFinite(Date.parse(sValue))) { return new Date(sValue); }
    return sValue;
  }


  /**
   * Wrap a value in an object if needed.
   */
  protected static _objectify(vValue: ParsedValue): object {
    if (vValue === null) return new EmptyTree();
    if (vValue instanceof Object) return vValue;
    return Object(vValue);
  }


  /**
   * Recursively create a JavaScript object tree from an XML element.
   */
  protected static _createObjTree(
    oParentNode: Element,
    nVerb: number,
    bFreeze: boolean,
    bNesteAttr: boolean
  ): JxonObject | ParsedValue {
    const nLevelStart = JXON._cache.length;
    const bChildren = oParentNode.hasChildNodes();
    const bAttributes = oParentNode.hasAttributes();
    const bHighVerb = Boolean(nVerb & 2);

    let nLength = 0;
    let sCollectedTxt = '';
    let vResult: any = bHighVerb ? {} : /* default value for empty nodes: */ true;

    if (bChildren) {
      for (let nItem = 0; nItem < oParentNode.childNodes.length; nItem++) {
        const oNode = oParentNode.childNodes.item(nItem);
        if (!oNode) continue;

        if (oNode.nodeType === 4) {
          /* nodeType is 'CDATASection' (4) */
          sCollectedTxt += oNode.nodeValue;
        } else if (oNode.nodeType === 3) {
          /* nodeType is 'Text' (3) */
          sCollectedTxt += oNode.nodeValue?.trim() ?? '';
        } else if (oNode.nodeType === 1 && !(oNode as Element).prefix) {
          /* nodeType is 'Element' (1) */
          JXON._cache.push(oNode as Element);
        }
      }
    }

    const nLevelEnd = JXON._cache.length;
    const vBuiltVal = JXON._parseText(sCollectedTxt);

    if (!bHighVerb && (bChildren || bAttributes)) {
      vResult = nVerb === 0 ? JXON._objectify(vBuiltVal) : {};
    }

    for (let nElId = nLevelStart; nElId < nLevelEnd; nElId++) {
      const sProp = JXON._cache[nElId].nodeName.toLowerCase();
      const vContent = JXON._createObjTree(JXON._cache[nElId], nVerb, bFreeze, bNesteAttr);

      if (Object.prototype.hasOwnProperty.call(vResult, sProp)) {
        if (!Array.isArray(vResult[sProp])) {
          vResult[sProp] = [vResult[sProp]];
        }
        vResult[sProp].push(vContent);
      } else {
        vResult[sProp] = vContent;
        nLength++;
      }
    }

    if (bAttributes) {
      const nAttrLen = oParentNode.attributes.length;
      const sAPrefix = bNesteAttr ? '' : JXON._ATTR_PREFIX;
      const oAttrParent: Record<string, ParsedValue> = bNesteAttr ? {} : vResult;

      for (let nAttrib = 0; nAttrib < nAttrLen; nLength++, nAttrib++) {
        const oAttrib = oParentNode.attributes.item(nAttrib);
        if (oAttrib) {
          oAttrParent[sAPrefix + oAttrib.name.toLowerCase()] = JXON._parseText(oAttrib.value.trim());
        }
      }

      if (bNesteAttr) {
        if (bFreeze) { Object.freeze(oAttrParent); }
        vResult[JXON._ATTRIBUTES_PROP] = oAttrParent;
        nLength -= nAttrLen - 1;
      }
    }

    if (nVerb === 3 || (nVerb === 2 || nVerb === 1 && nLength > 0) && sCollectedTxt) {
      vResult[JXON._VALUE_PROP] = vBuiltVal;
    } else if (!bHighVerb && nLength === 0 && sCollectedTxt) {
      vResult = vBuiltVal;
    }

    if (bFreeze && (bHighVerb || nLength > 0)) { Object.freeze(vResult); }

    JXON._cache.length = nLevelStart;

    return vResult;
  }


  /**
   * Recursively load a JavaScript object into an XML document.
   */
  protected static _loadObjTree(
    oXMLDoc: Document,
    oParentEl: Document | Element,
    oParentObj: any
  ): void {
    if (oParentObj instanceof String || oParentObj instanceof Number || oParentObj instanceof Boolean) {
      oParentEl.appendChild(oXMLDoc.createTextNode(oParentObj.toString()));
    } else if (oParentObj?.constructor === Date) {
      oParentEl.appendChild(oXMLDoc.createTextNode((oParentObj as Date).toUTCString()));
    }

    for (const sName in oParentObj) {
      const vValue = oParentObj[sName];
      if (isFinite(Number(sName)) || vValue instanceof Function) { continue; }

      if (sName === JXON._VALUE_PROP) {
        if (vValue !== null && vValue !== true) {
          const text = vValue?.constructor === Date ? (vValue as Date).toUTCString() : String(vValue);
          oParentEl.appendChild(oXMLDoc.createTextNode(text));
        }
      } else if (sName === JXON._ATTRIBUTES_PROP) {
        for (const sAttrib in vValue) {
          (oParentEl as Element).setAttribute(sAttrib, vValue[sAttrib]);
        }
      } else if (sName.charAt(0) === JXON._ATTR_PREFIX) {
        (oParentEl as Element).setAttribute(sName.slice(1), vValue);
      } else if (Array.isArray(vValue)) {
        for (const d of vValue) {
          const oChild = oXMLDoc.createElement(sName);
          JXON._loadObjTree(oXMLDoc, oChild, d);
          oParentEl.appendChild(oChild);
        }
      } else {
        const oChild = oXMLDoc.createElement(sName);
        if (vValue instanceof Object) {
          JXON._loadObjTree(oXMLDoc, oChild, vValue);
        } else if (vValue !== null && vValue !== true) {
          oChild.appendChild(oXMLDoc.createTextNode(vValue.toString()));
        }
        oParentEl.appendChild(oChild);
      }
    }
  }


  /**
   * Build a JavaScript object from an XML element.
   *
   * @param oXMLParent - The XML element to convert
   * @param nVerbosity - Verbosity level (0-3), default 1
   * @param bFreeze - Whether to freeze the resulting object
   * @param bNesteAttributes - Whether to nest attributes in a sub-object
   * @returns A JavaScript object representation of the XML
   */
  public static build(
    oXMLParent: Element,
    nVerbosity?: number,
    bFreeze?: boolean,
    bNesteAttributes?: boolean
  ): JxonObject | ParsedValue {
    const nVerb = typeof nVerbosity === 'number' ? nVerbosity & 3 : 1;
    const nesteAttr = bNesteAttributes ?? (nVerb === 3);
    return JXON._createObjTree(oXMLParent, nVerb, bFreeze ?? false, nesteAttr);
  }


  /**
   * Build an XML Document from a JavaScript object.
   *
   * @param oObjTree - The JavaScript object to convert
   * @returns An XML Document
   */
  public static unbuild(oObjTree: JxonObject): Document {
    const oNewDoc = document.implementation.createDocument('', '', null);
    JXON._loadObjTree(oNewDoc, oNewDoc, oObjTree);
    return oNewDoc;
  }


  /**
   * Convert a JavaScript object to an XML string.
   *
   * @param oObjTree - The JavaScript object to convert
   * @returns An XML string representation
   */
  public static stringify(oObjTree: JxonObject): string {
    return new XMLSerializer().serializeToString(JXON.unbuild(oObjTree));
  }
}
