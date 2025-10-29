import {BeforeSendFn as BeforeSendFnNodeJS, EventMessage} from "posthog-node";
import {BeforeSendFn as BeforeSendFnWeb, CaptureResult} from "posthog-js";
import {findPhoneNumbersInText} from "libphonenumber-js/max";

const sensitivePropertyKeyPattern = /email|username|phone|address|key/i;
const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const ccnPattern = /\b(?:\d[ -]*?){13,16}\b/;

export const beforePosthogSendNodeJS: BeforeSendFnNodeJS = (event: EventMessage | null): EventMessage | null => {
  return beforeSend(event);
}

export const beforePostHogSendWeb: BeforeSendFnWeb = (cr: CaptureResult | null): CaptureResult | null => {
  return beforeSend(cr);
}

function beforeSend<T extends EventMessage | CaptureResult>(event: T | null): T | null {
  // always drop events during playwright tests
  if (process.env.PLAYWRIGHT_TEST) {
    return null;
  }

  if (event) {
    const eventProps = event.properties as Record<string | number, any> // coerce to a common type interface

    // remove any properties with sensitive looking keys or values
    for (const [key, value] of Object.entries(eventProps || {})) {
      if (sensitivePropertyKeyPattern.test(key)) {
        console.warn(`Removing event property "${key}" due to sensitive key pattern match.`);
        delete eventProps[key];
        continue;
      }

      if (typeof value === 'string') {
        const foundPhoneNumbers = findPhoneNumbersInText(value, {defaultCountry: "US"});
        if (foundPhoneNumbers.length > 0) {
          console.warn(`Removing event property "${key}" because it looks like it contains a phone number`);
          delete eventProps[key];
          continue;
        }
        if (emailPattern.test(value) || ccnPattern.test(value)) {
          console.warn(`Removing event property "${key}" because it looks like it contains sensitive data or PII.`);
          delete eventProps[key];
        }
      }
    }
  }
  return event;
}
