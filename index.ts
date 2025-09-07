import OpenAI from "openai";
import readline from "readline";
import puppeteer from "puppeteer";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

type PriceData = {
  hour: string;
  price: string;
  numericPrice: number;
};

// Configure email transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function checkPrices() {
  console.log(
    "\n" + new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })
  );
  console.log("Fetching today's URL...");
  const todayUrl = getTodayUrl();
  console.log(`URL: ${todayUrl}`);

  console.log("\nFetching price table...");
  const prices = await fetchPriceTable();
  console.log("\nHourly Electricity Prices:");
  console.log("------------------------");
  if (prices.length === 0) {
    console.log("No prices found. The website structure might have changed.");
  } else {
    console.log("Hour Ending | Price (¢/kWh)");
    console.log("------------------------");
    prices.forEach(({ hour, price, numericPrice }) => {
      console.log(`${hour.padEnd(11)} | ${price}`);

      // Check if price is >= 1.5 cents
      const threshold = parseFloat(process.env.PRICE_THRESHOLD || "1.5");
      if (numericPrice >= threshold) {
        // Send email alert
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: process.env.EMAIL_USER,
          subject: `Price Alert: Electricity Price is ${price}`,
          text: "", // Currently Empty Message in Email body
        };

        transporter.sendMail(mailOptions, (error, info) => {
          if (error) {
            console.error("Error sending email:", error);
          } else {
            console.log(`Email alert sent for price ${price}`);
          }
        });
      }
    });
  }
}

checkPrices();

// Update the table every hour
setInterval(checkPrices, 60 * 60 * 1000); // 60 minutes * 60 seconds * 1000 milliseconds

console.log("Price monitoring started. Will check prices every hour.");
console.log("Press Ctrl+C to stop the program.");

function getTodayUrl(): string {
  const day = new Date();
  const mm = String(day.getMonth() + 1).padStart(2, "0");
  const dd = String(day.getDate()).padStart(2, "0");
  const yyyy = day.getFullYear();
  return `https://hourlypricing.comed.com/pricing-table-today/?date=${mm}/${dd}/${yyyy}`;
}

async function fetchPriceTable(): Promise<PriceData[]> {
  try {
    console.log("Launching browser...");
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    console.log("Navigating to ComEd pricing page...");
    await page.goto("https://hourlypricing.comed.com/pricing-table-today/");

    console.log("Setting current date...");
    const now = new Date();
    // CT (UTC-6 or UTC-5 with DST)
    const centralTime = new Date(
      now.toLocaleString("en-US", { timeZone: "America/Chicago" })
    );
    const dateString = `${
      centralTime.getMonth() + 1
    }/${centralTime.getDate()}/${centralTime.getFullYear()}`;

    // Find and fill the date input`
    await page.waitForSelector('input[type="text"]');
    await page.evaluate((date: string) => {
      const inputs = document.querySelectorAll(
        'input[type="text"]'
      ) as NodeListOf<HTMLInputElement>;
      for (const input of inputs) {
        if (input.value.includes("/")) {
          input.value = date;
          break;
        }
      }
    }, dateString);

    console.log("Clicking update and waiting for table refresh...");
    await page.click('input[type="submit"], button[type="submit"]');
    await page.waitForNavigation({ waitUntil: "networkidle0" });

    // Wait for table to be fully loaded
    await page.waitForSelector("table");

    // Extract table data
    console.log("Extracting hourly price data...");
    const tableData = await page.evaluate(() => {
      const rows = document.querySelectorAll("table tr");
      const data: PriceData[] = [];

      // Get column indices for the specific headers we want
      const headers = Array.from(rows[0]?.querySelectorAll("th") || []);
      const hourIndex = headers.findIndex((th) =>
        th.textContent?.trim().includes("Price for the Hour Ending")
      );
      const priceIndex = headers.findIndex(
        (th) =>
          th.textContent?.trim().includes("Hourly Price") &&
          th.textContent?.trim().includes("¢") &&
          th.textContent?.trim().includes("kWh")
      );

      // Skip header row and process data rows
      for (let i = 1; i < rows.length; i++) {
        const cells = rows[i].querySelectorAll("td");
        if (cells.length > Math.max(hourIndex, priceIndex)) {
          const hour = cells[hourIndex]?.textContent?.trim() || "";
          const price = cells[priceIndex]?.textContent?.trim() || "";
          if (hour && price) {
            // Convert price string to number (remove ¢ symbol if present)
            const numericPrice = parseFloat(price.replace("¢", ""));
            if (!isNaN(numericPrice)) {
              data.push({ hour, price, numericPrice });
            }
          }
        }
      }
      return data as Array<PriceData>;
    });

    await browser.close();
    return tableData;
  } catch (err) {
    console.error("Error fetching price table:", err);
    return [];
  }
}

/* Need to change the email to ouchakov@yahoo.com and create the new app password through
there. Change the .env file accordingly, and also change the PRICE_THRESHOLD to 5.0. Make 
sure that when the price has gone above 5.0 and then goes back below 5.0, another email
is sent. The email body should contain a link to the comed website that the information
was scraped from. */