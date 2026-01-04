/**
 * Migration Script: Assign Facilities to Existing Bookings
 * 
 * This script:
 * 1. Creates a "Default" facility for each turf that doesn't have facilities
 * 2. Assigns all existing bookings to their turf's default facility
 * 3. Ensures no bookings remain without a facility
 * 
 * The script is idempotent - safe to run multiple times.
 */

import mongoose from 'mongoose'
import dotenv from 'dotenv'
import path from 'path'
// Note: This script should be run with tsx or ts-node
// Example: npx tsx scripts/migrate-bookings-to-facilities.ts
import { Turf } from '../src/models/Turf'
import { Facility } from '../src/models/Facility'
import { Booking } from '../src/models/Booking'

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') })

const MONGODB_URI = process.env.MONGODB_URI || ''

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not set in environment variables')
  process.exit(1)
}

interface MigrationStats {
  turfsProcessed: number
  facilitiesCreated: number
  facilitiesReused: number
  bookingsUpdated: number
  bookingsSkipped: number
  errors: number
}

async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    })
    console.log('✅ Connected to MongoDB')
  }
  catch (error) {
    console.error('❌ MongoDB connection failed:', error)
    process.exit(1)
  }
}

async function migrateBookingsToFacilities() {
  const stats: MigrationStats = {
    turfsProcessed: 0,
    facilitiesCreated: 0,
    facilitiesReused: 0,
    bookingsUpdated: 0,
    bookingsSkipped: 0,
    errors: 0,
  }

  try {
    console.log('🚀 Starting migration: Assign Facilities to Existing Bookings\n')

    // Step 1: Get all turfs
    const turfs = await Turf.find({})
    console.log(`📋 Found ${turfs.length} turfs to process\n`)

    // Step 2: For each turf, ensure it has a default facility
    for (const turf of turfs) {
      stats.turfsProcessed++
      console.log(`Processing Turf: ${turf.name} (${turf._id})`)

      try {
        // Check if turf has any facilities
        const existingFacilities = await Facility.find({ turf: turf._id })

        let defaultFacility

        if (existingFacilities.length > 0) {
          // Use first active facility, or first facility if none are active
          defaultFacility = existingFacilities.find(f => f.isActive) || existingFacilities[0]
          stats.facilitiesReused++
          console.log(`  ✓ Using existing facility: ${defaultFacility.name} (${defaultFacility._id})`)
        }
        else {
          // Create default facility
          defaultFacility = await Facility.create({
            name: 'Default',
            turf: turf._id,
            isActive: true,
            // Copy pricing from turf
            pricingRules: turf.pricingRules || [],
            defaultPricePerSlot: turf.defaultPricePerSlot,
          })
          stats.facilitiesCreated++
          console.log(`  ✓ Created default facility: ${defaultFacility.name} (${defaultFacility._id})`)
        }

        // Step 3: Assign all bookings for this turf to the default facility
        const bookingsToUpdate = await Booking.find({
          turf: turf._id,
          $or: [
            { facility: { $exists: false } },
            { facility: null },
          ],
        })

        if (bookingsToUpdate.length > 0) {
          console.log(`  📝 Found ${bookingsToUpdate.length} bookings without facility`)
          
          for (const booking of bookingsToUpdate) {
            try {
              booking.facility = defaultFacility._id
              await booking.save()
              stats.bookingsUpdated++
            }
            catch (error: any) {
              console.error(`    ❌ Error updating booking ${booking._id}:`, error.message)
              stats.errors++
            }
          }
          console.log(`  ✓ Updated ${bookingsToUpdate.length} bookings`)
        }
        else {
          console.log(`  ✓ No bookings to update for this turf`)
          stats.bookingsSkipped++
        }

        console.log('')
      }
      catch (error: any) {
        console.error(`  ❌ Error processing turf ${turf._id}:`, error.message)
        stats.errors++
        console.log('')
      }
    }

    // Step 4: Verification
    console.log('🔍 Verifying migration...')
    const bookingsWithoutFacility = await Booking.countDocuments({
      $or: [
        { facility: { $exists: false } },
        { facility: null },
      ],
    })

    if (bookingsWithoutFacility > 0) {
      console.warn(`⚠️  Warning: ${bookingsWithoutFacility} bookings still without facility`)
    }
    else {
      console.log('✅ All bookings have been assigned a facility')
    }

    // Print summary
    console.log('\n' + '='.repeat(50))
    console.log('📊 Migration Summary')
    console.log('='.repeat(50))
    console.log(`Turfs Processed: ${stats.turfsProcessed}`)
    console.log(`Facilities Created: ${stats.facilitiesCreated}`)
    console.log(`Facilities Reused: ${stats.facilitiesReused}`)
    console.log(`Bookings Updated: ${stats.bookingsUpdated}`)
    console.log(`Bookings Skipped: ${stats.bookingsSkipped}`)
    console.log(`Errors: ${stats.errors}`)
    console.log(`Bookings Without Facility (after migration): ${bookingsWithoutFacility}`)
    console.log('='.repeat(50))

    if (bookingsWithoutFacility === 0 && stats.errors === 0) {
      console.log('\n✅ Migration completed successfully!')
    }
    else {
      console.log('\n⚠️  Migration completed with warnings. Please review the output above.')
    }
  }
  catch (error) {
    console.error('❌ Migration failed:', error)
    throw error
  }
}

async function main() {
  try {
    await connectDB()
    await migrateBookingsToFacilities()
  }
  catch (error) {
    console.error('Fatal error:', error)
    process.exit(1)
  }
  finally {
    await mongoose.disconnect()
    console.log('\n👋 Disconnected from MongoDB')
    process.exit(0)
  }
}

// Run migration
if (require.main === module) {
  main()
}

export { migrateBookingsToFacilities }

