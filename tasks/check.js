require('dotenv').config({ silent: true });

const Alert = require('../lib/bot/alert.js');
const mgEmail = require('../lib/bot/send-email.js');
const sms = require('../lib/bot/send-sms.js');
const { PROXY, ALERT_TYPES, MAX_PAGES, BASE_URL } = require('../lib/constants.js');
const mongoose = require('../lib/mongo.js');

const puppeteer = require('puppeteer');
const Semaphore = require('semaphore-async-await').default;

(async () => {
  let browserOptions = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

  if (PROXY !== undefined) {
    browserOptions.append('--proxy-server=' + PROXY);
  }

  // add `headless: false` for debugging SW changes
  let = browser = await puppeteer.launch({ args: browserOptions });

  try {
    const alerts = await Alert.allActiveAlerts();
    const lock = new Semaphore(MAX_PAGES);

    console.log(`found ${alerts.length} alerts, checking...`);

    const promises = alerts
      .sort((a, b) => a.date - b.date)
      .map(async alert => {
        const flight = `${alert.formattedDate} #${alert.number} ${alert.from} → ${alert.to}`;
        debugger
        // delete alert if in past
        if (alert.date < Date.now()) {
          console.log(`${flight} expired, deleting`);
          flight.delete();
          return;
        }

        // get current price
        await alert.getLatestPrice(browser, lock);
        alert.save();

        // send message if cheaper
        const less = alert.price - alert.latestPrice;
        if (less > 0) {
          console.log(`${flight} dropped ${alert.formattedPriceDifference} to ${alert.formattedLatestPrice}`);

          let message;
          if (alert.alertType === ALERT_TYPES.SINGLE) {
            message = [
              `WN flight #${alert.number} `,
              `${alert.from} to ${alert.to} on ${alert.formattedDate} `,
              `was ${alert.formattedPrice}, is now ${alert.formattedLatestPrice}. `,
              `\n\nOnce rebooked, tap link to lower alert threshold: `,
              `${BASE_URL}/${alert.id}/change-price?price=${alert.latestPrice}`
            ].join('');
          } else if (alert.alertType === ALERT_TYPES.DAY) {
            message = [
              `A cheaper Southwest flight on ${alert.formattedDate} `,
              `${alert.from} to ${alert.to} was found! `,
              `Was ${alert.formattedPrice}, is now ${alert.formattedLatestPrice}. `,
              `\n\nOnce rebooked, tap link to lower alert threshold: `,
              `${BASE_URL}/${alert.id}/change-price?price=${alert.latestPrice}`
            ].join('');
          }

          const subject = `✈ Southwest Price Drop Alert: ${alert.formattedPrice} → ${alert.formattedLatestPrice}`;

          if (mgEmail.enabled && alert.toEmail) { await mgEmail.sendEmail(alert.toEmail, subject, message); }
          if (sms.enabled && alert.phone) { await sms.sendSms(alert.phone, message); }
        } else {
          console.log(`${flight} not cheaper`);
        }
      });

    await Promise.all(promises);
  } catch (e) {
    console.error(e);
  } finally {
    await browser.close();
    await mongoose.connection.close();
  }
})();
